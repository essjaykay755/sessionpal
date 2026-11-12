//! Timing observations are deliberately separate from transcript timestamps:
//! readers sometimes synthesize the latter from file metadata.
use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::Value;

const ACTIVE_GAP_MS: i64 = 15 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityInterval {
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimingEntry {
    pub id: String,
    pub source: String,
    pub kind: String,
    pub timestamp: String,
    pub duration_ms: i64,
    pub status: String,
    pub time_to_first_token_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTiming {
    pub activity_intervals: Vec<ActivityInterval>,
    pub event_count: usize,
    pub first_activity: String,
    pub last_activity: String,
    pub elapsed_ms: Option<i64>,
    pub entries: Vec<TimingEntry>,
}

#[derive(Default)]
pub struct Collector {
    stamps: BTreeSet<i64>,
    entries: BTreeMap<String, TimingEntry>,
    starts: HashMap<String, i64>,
}

fn millis(value: &Value) -> Option<i64> {
    let stamp = crate::util::parse_time(value)?;
    chrono::DateTime::parse_from_rfc3339(&stamp)
        .ok()
        .map(|time| time.timestamp_millis())
}

fn iso(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .unwrap()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn duration(value: &Value) -> Option<i64> {
    let number = value.as_f64()?;
    (number.is_finite() && number >= 0.0 && number <= 9_007_199_254_740_991.0)
        .then_some(number as i64)
}

/// True only for actual user/assistant/tool content. Injected and synthetic
/// text does not establish that a person or agent was active.
pub fn genuine_content(value: &Value) -> bool {
    if value.get("synthetic").and_then(Value::as_bool) == Some(true) {
        return false;
    }
    if let Some(text) = value.as_str() {
        return !text.trim().is_empty() && !crate::util::is_injected_context(text);
    }
    if let Some(parts) = value.as_array() {
        return parts.iter().any(genuine_content);
    }
    if let Some(text) = value.get("text").and_then(Value::as_str) {
        return genuine_content(&Value::String(text.to_string()));
    }
    matches!(
        value.get("type").and_then(Value::as_str),
        Some("tool_use" | "tool_result" | "tool" | "image" | "input_image")
    )
}

impl Collector {
    pub fn activity(&mut self, value: &Value) {
        if let Some(ms) = millis(value) {
            self.stamps.insert(ms);
        }
    }

    pub fn claude(&mut self, value: &Value) {
        if matches!(
            value.get("type").and_then(Value::as_str),
            Some("user" | "assistant")
        ) && value.get("isMeta").and_then(Value::as_bool) != Some(true)
            && genuine_content(&value["message"]["content"])
        {
            self.activity(&value["timestamp"]);
        }
    }

    pub fn codex(&mut self, value: &Value) {
        let payload = &value["payload"];
        let stamp = &value["timestamp"];
        match value["type"].as_str() {
            Some("response_item") => {
                let actual = match payload["type"].as_str() {
                    Some("message") => {
                        matches!(payload["role"].as_str(), Some("user" | "assistant"))
                            && genuine_content(&payload["content"])
                    }
                    Some(
                        "function_call"
                        | "function_call_output"
                        | "custom_tool_call"
                        | "custom_tool_call_output"
                        | "reasoning",
                    ) => true,
                    _ => false,
                };
                if actual {
                    self.activity(stamp);
                }
            }
            Some("event_msg") => {
                let kind = payload["type"].as_str().unwrap_or("");
                if !matches!(
                    kind,
                    "task_started" | "task_complete" | "turn_aborted" | "item_completed"
                ) {
                    return;
                }
                self.activity(stamp);
                let Some(id) = payload["turn_id"].as_str() else {
                    return;
                };
                if kind == "task_started" {
                    if let Some(start) = millis(&payload["started_at"]).or_else(|| millis(stamp)) {
                        self.starts.entry(id.to_string()).or_insert(start);
                    }
                    return;
                }
                if kind == "item_completed" {
                    return;
                }
                let start = millis(&payload["started_at"]).or_else(|| self.starts.get(id).copied());
                let end = millis(&payload["completed_at"]).or_else(|| millis(stamp));
                if matches!((start, end), (Some(a), Some(b)) if b < a) {
                    return;
                }
                let elapsed = if payload.get("duration_ms").is_some() {
                    duration(&payload["duration_ms"])
                } else {
                    start.zip(end).map(|(a, b)| b - a)
                };
                let Some((elapsed, end)) = elapsed.zip(end) else {
                    return;
                };
                let ttft = duration(&payload["time_to_first_token_ms"]).filter(|ms| *ms <= elapsed);
                let entry = TimingEntry {
                    id: id.to_string(),
                    source: "Codex turn event".into(),
                    kind: "turn".into(),
                    timestamp: iso(end),
                    duration_ms: elapsed,
                    status: if kind == "turn_aborted" {
                        "interrupted"
                    } else {
                        "completed"
                    }
                    .into(),
                    time_to_first_token_ms: ttft,
                };
                // Repeated terminal records for a turn count once. Prefer a
                // successful completion if an interrupted record was also saved.
                let key = format!("turn:{id}");
                if self
                    .entries
                    .get(&key)
                    .map_or(true, |old| old.status != "completed")
                {
                    self.entries.insert(key, entry);
                }
                if let Some(start) = start {
                    self.stamps.insert(start);
                }
                self.stamps.insert(end);
            }
            _ => {}
        }
    }

    /// OpenCode's explicit message time.created/time.completed is response
    /// elapsed time, not a network-request latency measurement.
    pub fn opencode(&mut self, value: &Value, id: &str, role: &str, created: &Value) {
        if !matches!(role, "user" | "assistant") || value["synthetic"].as_bool() == Some(true) {
            return;
        }
        self.activity(created);
        if role != "assistant" {
            return;
        }
        let start = millis(&value["time"]["created"]).or_else(|| millis(created));
        let end = millis(&value["time"]["completed"]);
        let Some((start, end)) = start.zip(end).filter(|(a, b)| b >= a) else {
            return;
        };
        self.stamps.insert(start);
        self.stamps.insert(end);
        self.entries
            .entry(format!("response:{id}"))
            .or_insert_with(|| TimingEntry {
                id: id.into(),
                source: "OpenCode message time".into(),
                kind: "response".into(),
                timestamp: iso(end),
                duration_ms: end - start,
                status: if value
                    .get("error")
                    .filter(|error| !error.is_null())
                    .is_some()
                {
                    "error"
                } else {
                    "completed"
                }
                .into(),
                time_to_first_token_ms: None,
            });
    }

    pub fn opencode_part(&mut self, part: &Value) {
        if !genuine_content(part) {
            return;
        }
        for time in [&part["time"], &part["state"]["time"]] {
            self.activity(&time["start"]);
            self.activity(&time["end"]);
        }
    }

    pub fn finish(self) -> Option<SessionTiming> {
        let first = *self.stamps.first()?;
        let last = *self.stamps.last()?;
        let mut intervals: Vec<ActivityInterval> = Vec::new();
        let stamps: Vec<i64> = self.stamps.iter().copied().collect();
        for pair in stamps.windows(2) {
            if pair[1] - pair[0] > ACTIVE_GAP_MS {
                continue;
            }
            if let Some(previous) = intervals
                .last_mut()
                .filter(|interval| interval.end_ms == pair[0])
            {
                previous.end_ms = pair[1];
            } else {
                intervals.push(ActivityInterval {
                    start_ms: pair[0],
                    end_ms: pair[1],
                });
            }
        }
        let mut entries: Vec<_> = self.entries.into_values().collect();
        entries.sort_by(|a, b| a.timestamp.cmp(&b.timestamp).then_with(|| a.id.cmp(&b.id)));
        Some(SessionTiming {
            activity_intervals: intervals,
            event_count: stamps.len(),
            first_activity: iso(first),
            last_activity: iso(last),
            elapsed_ms: (stamps.len() >= 2).then_some(last - first),
            entries,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn opencode_completion_requires_ordered_explicit_endpoints() {
        let base = 1_790_000_000_000i64;
        for completed in [Value::Null, json!(base - 1), json!("invalid")] {
            let mut collector = Collector::default();
            collector.opencode(
                &json!({"time":{"created":base,"completed":completed}}),
                "m",
                "assistant",
                &json!(base),
            );
            assert!(collector.finish().unwrap().entries.is_empty());
        }
        let mut collector = Collector::default();
        collector.opencode(
            &json!({"error":{"message":"failed"},"time":{"created":base,"completed":base+5000}}),
            "m",
            "assistant",
            &json!(base),
        );
        let timing = collector.finish().unwrap();
        assert_eq!(timing.entries[0].duration_ms, 5000);
        assert_eq!(timing.entries[0].status, "error");
    }

    #[test]
    fn activity_is_sorted_unique_compact_and_excludes_long_gaps() {
        let mut collector = Collector::default();
        let base = 1_790_000_000_000i64;
        for offset in [1_800_001, 900_000, 0, 900_000, 2_100_001] {
            collector.activity(&json!(base + offset));
        }
        collector.activity(&json!("invalid"));
        let result = collector.finish().unwrap();
        assert_eq!(result.event_count, 4);
        assert_eq!(result.elapsed_ms, Some(2_100_001));
        assert_eq!(result.activity_intervals.len(), 2);
        assert_eq!(
            result.activity_intervals[0].end_ms - result.activity_intervals[0].start_ms,
            900_000
        );
        assert_eq!(
            result.activity_intervals[1].end_ms - result.activity_intervals[1].start_ms,
            300_000
        );
    }

    #[test]
    fn single_missing_and_administrative_events_are_not_elapsed_time() {
        assert!(Collector::default().finish().is_none());
        let mut collector = Collector::default();
        collector.claude(&json!({"type":"summary","timestamp":"2026-11-05T09:00:00Z"}));
        collector.claude(&json!({"type":"user","isMeta":true,"timestamp":"2026-11-05T09:01:00Z","message":{"content":"context"}}));
        assert!(collector.finish().is_none());
        let mut collector = Collector::default();
        collector.activity(&json!("2026-11-05T09:00:00Z"));
        let result = collector.finish().unwrap();
        assert_eq!(result.event_count, 1);
        assert_eq!(result.elapsed_ms, None);
        assert!(result.activity_intervals.is_empty());
    }

    #[test]
    fn codex_terminal_events_deduplicate_and_keep_interruptions() {
        let mut collector = Collector::default();
        let completed = json!({"type":"event_msg", "timestamp":"2026-11-05T09:00:10Z", "payload":{
            "type":"task_complete", "turn_id":"t1", "started_at":"2026-11-05T09:00:00Z",
            "completed_at":"2026-11-05T09:00:10Z", "duration_ms":10000,"time_to_first_token_ms":123}});
        collector.codex(&completed);
        collector.codex(&completed);
        collector.codex(&json!({"type":"event_msg","timestamp":"2026-11-05T09:01:10Z","payload":{
            "type":"turn_aborted","turn_id":"t2","started_at":"2026-11-05T09:01:00Z","duration_ms":10000}}));
        let timing = collector.finish().unwrap();
        assert_eq!(timing.entries.len(), 2);
        assert_eq!(timing.entries[0].time_to_first_token_ms, Some(123));
        assert_eq!(timing.entries[1].status, "interrupted");
    }

    #[test]
    fn codex_matches_starts_but_never_guesses_from_chat() {
        let mut collector = Collector::default();
        for payload in [
            json!({"type":"task_started","turn_id":"a"}),
            json!({"type":"task_complete","turn_id":"a"}),
        ] {
            let stamp = if payload["type"] == "task_started" {
                "2026-11-05T09:00:00Z"
            } else {
                "2026-11-05T09:00:05Z"
            };
            collector.codex(&json!({"type":"event_msg","timestamp":stamp,"payload":payload}));
        }
        assert_eq!(collector.finish().unwrap().entries[0].duration_ms, 5000);
        let mut collector = Collector::default();
        collector.codex(
            &json!({"type":"response_item","timestamp":"2026-11-05T09:00:00Z","payload":{
            "type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}}),
        );
        assert!(collector.finish().unwrap().entries.is_empty());
    }

    #[test]
    fn malformed_durations_and_reversed_endpoints_are_rejected() {
        for bad in [json!(-1), json!("100"), json!(null), json!(1e30)] {
            let mut collector = Collector::default();
            collector.codex(
                &json!({"type":"event_msg","timestamp":"2026-11-05T09:00:10Z","payload":{
                "type":"task_complete","turn_id":"t","duration_ms":bad}}),
            );
            assert!(collector.finish().unwrap().entries.is_empty());
        }
        let mut collector = Collector::default();
        collector.codex(&json!({"type":"event_msg","timestamp":"2026-11-05T09:00:10Z","payload":{
            "type":"task_complete","turn_id":"t","duration_ms":5,"started_at":"2026-11-05T09:01:00Z"}}));
        assert!(collector.finish().unwrap().entries.is_empty());
    }

    #[test]
    fn injected_and_synthetic_content_is_not_activity() {
        assert!(!genuine_content(
            &json!({"type":"text","text":"hello", "synthetic":true})
        ));
        let mut collector = Collector::default();
        collector.codex(
            &json!({"type":"response_item","timestamp":"2026-11-05T09:00:00Z","payload":{
            "type":"message","role":"developer","content":[{"text":"instructions"}]}}),
        );
        assert!(collector.finish().is_none());
    }
}

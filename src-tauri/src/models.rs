use serde::{Deserialize, Serialize};

/// The local agents SessionPal understands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentId {
    Claude,
    Codex,
    Cursor,
    Opencode,
    Antigravity,
}

impl AgentId {
    pub const ALL: [AgentId; 5] = [
        AgentId::Claude,
        AgentId::Codex,
        AgentId::Cursor,
        AgentId::Opencode,
        AgentId::Antigravity,
    ];

    pub fn name(self) -> &'static str {
        match self {
            AgentId::Claude => "Claude Code",
            AgentId::Codex => "Codex",
            AgentId::Cursor => "Cursor",
            AgentId::Opencode => "OpenCode",
            AgentId::Antigravity => "Antigravity",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDetection {
    pub id: AgentId,
    pub name: String,
    pub available: bool,
    pub roots: Vec<String>,
    pub session_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBreakdown {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub cost: Option<f64>,
}

impl UsageBreakdown {
    pub fn is_empty(&self) -> bool {
        self.input == 0 && self.output == 0 && self.cache_read == 0 && self.cache_write == 0
    }

    pub fn tokens(&self) -> u64 {
        self.input
            .saturating_add(self.output)
            .saturating_add(self.cache_read)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub agent: AgentId,
    pub title: String,
    pub excerpt: String,
    pub project: String,
    pub project_label: String,
    pub cwd: String,
    pub branch: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: u64,
    pub tokens: u64,
    pub size_bytes: u64,
    pub model: Option<String>,
    pub models: Vec<String>,
    pub usage: Option<UsageBreakdown>,
    pub format: String,
    pub path: String,
    pub deletable: bool,
    pub tint: String,
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    #[serde(flatten)]
    pub summary: SessionSummary,
    pub messages: Vec<Message>,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub size_bytes: u64,
    pub session_count: u64,
    pub agents: Vec<AgentId>,
    pub file_count: u64,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub demo: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLocator {
    pub id: String,
    pub agent: AgentId,
    pub path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub deleted: u64,
    pub skipped: u64,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub written: u64,
    pub destination: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBackupResult {
    pub destination: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    /// Files that were missing and have been written back.
    pub restored: u64,
    /// Files already on disk with identical contents.
    pub unchanged: u64,
    /// Files already on disk with different contents, left untouched.
    pub kept_local: u64,
    /// Database archive entries (Cursor, OpenCode, Antigravity); live databases are never written to.
    pub skipped_read_only: u64,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub app_data_dir: String,
    pub backup_dir: String,
}

/// Manifest stored as `manifest.json` at the root of every native backup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub format_version: u32,
    pub created_by: String,
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub agents: Vec<AgentId>,
    pub session_count: u64,
    pub file_count: u64,
    pub files: Vec<ManifestFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFile {
    /// Relative path inside the ZIP. Always validated before extraction.
    pub archive_path: String,
    /// Original absolute path on this device.
    pub original_path: String,
    pub agent: AgentId,
    /// session | opencode-message | opencode-part | opencode-todo | cursor-chats |
    /// opencode-chats | antigravity-index | antigravity-conversation
    /// (`cursor-db` in older archives)
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Path relative to the agent's storage root, `/`-separated. Lets an archive
    /// be restored on another machine or user account. Absent in older archives.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<String>,
}

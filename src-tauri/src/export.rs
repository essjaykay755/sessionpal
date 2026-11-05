use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::agents;
use crate::models::{ExportResult, SessionDetail, SessionLocator};
use crate::util::iso_now;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsonExport {
    exported_by: &'static str,
    exported_at: String,
    demo_data: bool,
    sessions: Vec<SessionDetail>,
}

pub fn export_sessions(
    locators: &[SessionLocator],
    format: &str,
    destination: &Path,
) -> Result<ExportResult, String> {
    if locators.is_empty() {
        return Err("Select at least one session to export.".to_string());
    }
    if destination.as_os_str().is_empty() {
        return Err("Choose a destination for the export.".to_string());
    }
    let mut details = Vec::with_capacity(locators.len());
    for locator in locators {
        details.push(agents::get_session(locator)?);
    }

    let count = details.len() as u64;
    let content = match format {
        "json" => {
            let export = JsonExport {
                exported_by: "SessionPal",
                exported_at: iso_now(),
                demo_data: false,
                sessions: details,
            };
            serde_json::to_string_pretty(&export)
                .map_err(|error| format!("Could not serialize the export: {error}"))?
        }
        "markdown" => markdown_export(&details),
        _ => return Err("Unsupported export format.".to_string()),
    };

    if let Some(parent) = destination.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create the export folder: {error}"))?;
        }
    }
    fs::write(destination, content)
        .map_err(|error| format!("Could not write the export: {error}"))?;

    Ok(ExportResult {
        written: count,
        destination: destination.to_string_lossy().to_string(),
    })
}

fn markdown_export(details: &[SessionDetail]) -> String {
    if details.len() == 1 {
        return session_markdown(&details[0]);
    }
    let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
    let mut output = format!(
        "# SessionPal export\n\n_{} local sessions · exported {stamp}_\n\n",
        details.len()
    );
    for detail in details {
        output.push_str("---\n\n");
        output.push_str(&session_markdown(detail));
        output.push_str("\n\n");
    }
    output
}

fn session_markdown(detail: &SessionDetail) -> String {
    let cost = detail
        .summary
        .usage
        .as_ref()
        .and_then(|usage| usage.cost)
        .map(|cost| format!("{cost:.4}"))
        .unwrap_or_else(|| "unknown".to_string());
    let mut output = String::new();
    output.push_str("---\n");
    output.push_str(&format!(
        "title: {}\n",
        serde_json::to_string(&detail.summary.title).unwrap_or_else(|_| "\"\"".to_string())
    ));
    output.push_str(&format!("agent: {}\n", detail.summary.agent.name()));
    output.push_str(&format!(
        "project: {}\n",
        serde_json::to_string(&detail.summary.project_label).unwrap_or_else(|_| "\"\"".to_string())
    ));
    output.push_str(&format!(
        "model: {}\n",
        detail.summary.model.as_deref().unwrap_or("unknown")
    ));
    output.push_str(&format!("created: {}\n", detail.summary.created_at));
    output.push_str(&format!("updated: {}\n", detail.summary.updated_at));
    output.push_str(&format!("messages: {}\n", detail.messages.len()));
    output.push_str(&format!("tokens: {}\n", detail.summary.tokens));
    output.push_str(&format!("estimated_cost_usd: {cost}\n"));
    output.push_str(&format!(
        "source: {}\n",
        serde_json::to_string(&detail.summary.path).unwrap_or_else(|_| "\"\"".to_string())
    ));
    output.push_str("exported_by: SessionPal\n");
    output.push_str("demo_data: false\n");
    output.push_str("---\n\n");
    output.push_str(&format!("# {}\n\n", detail.summary.title));
    output.push_str(&format!("> {}\n\n", detail.summary.excerpt));
    for message in &detail.messages {
        if message.role == "tool" {
            output.push_str(&format!(
                "### Tool · {}\n\n> {}\n\n```\n{}\n```\n\n",
                message.tool_name.as_deref().unwrap_or("Call"),
                message.tool_detail.as_deref().unwrap_or(""),
                message.content
            ));
        } else {
            let role = match message.role.as_str() {
                "user" => "You",
                "assistant" => "Assistant",
                _ => "System",
            };
            output.push_str(&format!("## {role}\n\n{}\n\n", message.content));
        }
    }
    output
}

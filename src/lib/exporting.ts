import { strToU8, zipSync } from "fflate";
import { AGENTS } from "./agents";
import type {
  BackupRecord,
  ExportFormat,
  SessionDetail,
  SessionSummary,
} from "./types";
import { bytes, downloadBlob, filenameStamp, number, slugify } from "./utils";

function frontMatter(detail: SessionDetail): string {
  const lines = [
    "---",
    `title: ${JSON.stringify(detail.title)}`,
    `agent: ${AGENTS[detail.agent].name}`,
    `project: ${JSON.stringify(detail.projectLabel)}`,
    `model: ${detail.model ?? "unknown"}`,
    `created: ${detail.createdAt}`,
    `updated: ${detail.updatedAt}`,
    `messages: ${detail.messages.length}`,
    `tokens: ${detail.tokens}`,
    `estimated_cost_usd: ${detail.usage?.cost?.toFixed(4) ?? "unknown"}`,
    `source: ${JSON.stringify(detail.path)}`,
    "exported_by: SessionPal",
    "demo_data: " + (detail.demo ? "true" : "false"),
    "---",
    "",
  ];
  return lines.join("\n");
}

export function sessionToMarkdown(detail: SessionDetail): string {
  const body = detail.messages
    .map((message) => {
      if (message.role === "tool") {
        return `### Tool · ${message.toolName ?? "Call"}\n\n> ${message.toolDetail ?? message.content}\n\n\`\`\`\n${message.content}\n\`\`\`\n`;
      }
      const role = message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "System";
      return `## ${role}\n\n${message.content}\n`;
    })
    .join("\n");
  return `${frontMatter(detail)}\n# ${detail.title}\n\n> ${detail.excerpt}\n\n${body}`;
}

export function sessionsToJson(details: SessionDetail[]): string {
  return JSON.stringify(
    {
      exportedBy: "SessionPal",
      exportedAt: new Date().toISOString(),
      demoData: details.every((detail) => detail.demo === true),
      sessions: details.map((detail) => ({
        ...detail,
        messages: detail.messages,
      })),
    },
    null,
    2,
  );
}

export function exportSessionsToBrowser(
  details: SessionDetail[],
  format: ExportFormat,
): string {
  const stamp = filenameStamp();
  if (format === "json") {
    const content = sessionsToJson(details);
    const filename =
      details.length === 1
        ? `${slugify(details[0].title)}-${stamp}.json`
        : `sessionpal-export-${stamp}.json`;
    downloadBlob(new Blob([content], { type: "application/json" }), filename);
    return filename;
  }
  const content =
    details.length === 1
      ? sessionToMarkdown(details[0])
      : `# SessionPal export\n\n_${details.length} local sessions · exported ${new Date().toLocaleString()}_\n\n${details
          .map((detail) => `---\n\n${sessionToMarkdown(detail)}`)
          .join("\n\n")}`;
  const filename =
    details.length === 1
      ? `${slugify(details[0].title)}-${stamp}.md`
      : `sessionpal-export-${stamp}.md`;
  downloadBlob(new Blob([content], { type: "text/markdown" }), filename);
  return filename;
}

export function createDemoBackupZip(
  backup: BackupRecord,
  sessions: SessionSummary[],
  details: SessionDetail[],
): string {
  const files: Record<string, Uint8Array> = {};
  const manifest = {
    formatVersion: 1,
    demo: true,
    createdBy: "SessionPal browser preview",
    name: backup.name,
    createdAt: backup.createdAt,
    sessionCount: backup.sessionCount,
    agentCounts: backup.agents.reduce<Record<string, number>>((counts, agent) => {
      counts[agent] = sessions.filter((session) => session.agent === agent).length;
      return counts;
    }, {}),
    note: "This archive was generated from sample data for preview purposes. The desktop app writes the same manifest shape alongside the original session files.",
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  files["sessions-summary.json"] = strToU8(
    JSON.stringify(
      sessions.map((session) => ({
        id: session.id,
        agent: session.agent,
        title: session.title,
        project: session.project,
        updatedAt: session.updatedAt,
        tokens: session.tokens,
        model: session.model,
      })),
    ),
  );
  for (const detail of details) {
    files[`sessions/${detail.agent}/${slugify(detail.title)}-${detail.id}.md`] = strToU8(
      sessionToMarkdown(detail),
    );
  }
  files["README.txt"] = strToU8(
    [
      "SessionPal sample backup",
      "========================",
      "",
      "This archive was created by the browser preview using sample data.",
      "It contains a manifest, a compact session index, and a sample of full transcripts.",
      "The native application writes a complete archive of your local session files.",
      "",
      "No data leaves your device.",
    ].join("\n"),
  );
  const zipped = zipSync(files, { level: 6 });
  const filename = `sessionpal-${slugify(backup.name)}-${filenameStamp()}-demo.zip`;
  downloadBlob(new Blob([zipped], { type: "application/zip" }), filename);
  return filename;
}

export function backupSummaryText(backup: BackupRecord): string {
  return `${number(backup.sessionCount)} sessions · ${bytes(backup.sizeBytes)} · ${
    backup.agents.length
  } agents`;
}

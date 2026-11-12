# SessionPal: data, privacy and safety

[← Back to README](../README.md)

## First launch

The desktop app asks before it reads anything:

1. **Find agents.** A quick read-only check lists the agents installed on this
   computer, with their session counts and storage paths.
2. **Choose agents.** Agents you switch off are never read. This can be changed
   later under Settings → Storage → Agents.
3. **Project folders (macOS only).** To name projects and group worktrees with
   their repository, SessionPal checks each session's folder for `.git` and
   `package.json`. If sessions ran inside a folder macOS protects (Documents,
   Desktop, Downloads, iCloud Drive or an external drive), setup explains this
   first and only then lets macOS ask. Choose **Allow**. Folders you skip or
   deny are never touched; their projects use the folder name. To change a
   decision later, use Settings → Project folders, or System Settings →
   Privacy & Security → Files and Folders → SessionPal.

During development (`npm run tauri:dev`) macOS attributes these prompts to
your terminal app rather than SessionPal. Use a built app to see the real
prompts. The browser preview can show the setup screens at
`http://localhost:1420/?setup`.

## Privacy and safety

- Conversations are never uploaded. There is no analytics or crash reporting.
  SessionPal checks GitHub Releases for updates on launch and every six hours
  while open; turn this off in Settings → General. Manual checks are available there.
- The browser preview uses deterministic sample data and labels itself as such.
- All destructive actions happen only in the desktop app, after confirmation.
- Conversation search keeps a copy of what you and the agents wrote in an
  SQLite full-text index (`search-index.db`) in SessionPal's cache folder. It
  never leaves the device, skips tool output, drops conversations that leave
  the library, and can be rebuilt from Settings → Storage.
- Cursor sessions are **read-only**. SessionPal reads `state.vscdb` through
  SQLite's read-only API and never writes to it, including during a restore.
  Cursor backups copy only chat rows (`composerData:*`, `bubbleId:*`) into a
  separate database, so settings and sign-in tokens never end up in an archive.
- OpenCode's `opencode.db` (used by OpenCode 1.x and later) is read the same
  way: read-only, never deleted from, and backed up as a copy of its chat
  tables only, without its account and credential tables.
- Antigravity is read the same way. Titles, workspaces and conversation text
  come from its `conversation_summaries.db` index; model and token counts come
  from each conversation's own database. Its encrypted `.pb` files are never
  read. Sub-agent runs are folded into the conversation that started them.
- Deletions and restores are checked against discovered agent roots, with
  symlinks resolved, so a path cannot escape the expected storage.
- Restores reject absolute paths, traversal, symlinks, duplicate targets,
  unsupported entry kinds and oversized archives. Files are staged in a
  temporary folder before any live file is touched.
- Backups are created only when you ask; there are no scheduled jobs.
- Backups of Claude Code, Codex and file-based OpenCode sessions are
  **restorable**. Cursor, Antigravity and database-backed OpenCode
  conversations are **archive only**: they are kept in the archive for
  inspection and export, but restore never writes them into those apps' live
  databases. The Backups page labels each archive accordingly.

## Supported agents

| Agent | Storage read | Format | Delete |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/projects`, `$CLAUDE_CONFIG_DIR/projects`, `~/.config/claude/projects` | JSONL | Yes |
| Codex | `~/.codex/sessions`, `$CODEX_HOME/sessions` | JSONL rollouts | Yes |
| Cursor | `state.vscdb` under the platform Cursor data folder | SQLite `cursorDiskKV` | No, read-only |
| OpenCode | `~/.local/share/opencode/opencode.db` (current) or `storage/` (older), also under `$OPENCODE_DATA_HOME` and `$XDG_DATA_HOME/opencode` | SQLite, or JSON session + message + part files | Database: no, read-only. JSON: yes |
| Antigravity | `~/.gemini/antigravity/conversation_summaries.db` plus `conversations/<id>.db` | SQLite index with conversation text; per-conversation model and token data | No, read-only |

SessionPal also recognises agent roots that are not installed yet when
validating a restore, so an archive can be restored after a reinstall. Archives
record each file's path relative to its agent root, so a backup imported from
another computer or user account is restored into this machine's agent folders.

## Data locations

| Data | Location |
| --- | --- |
| Backups | Tauri app-data folder `com.sessionpal.desktop/backups` |
| Backup folder (macOS) | `~/Library/Application Support/com.sessionpal.desktop/backups` |
| Backup folder (Windows) | `%APPDATA%\com.sessionpal.desktop\backups` |
| Backup folder (Linux) | `~/.local/share/com.sessionpal.desktop/backups` |
| Settings | Local browser storage for this app only |

The real path is resolved at runtime and shown in **Settings** and **Backups**.

## Cost estimates

SessionPal refreshes public model rates from models.dev at most daily and caches
them locally. The request sends no session data. Offline, it uses the last cached
catalog and the bundled `src/lib/pricing-catalog.json` as a fallback. Free model
IDs are matched only to a corresponding paid offering listed by the same provider;
ambiguous or unavailable rates remain unpriced. Missing cache rates use the input
rate. Current rates are estimates and may differ from historical or provider bills.
SessionPal does not know your subscription, credits, or provider
billing. Every amount shown is an **API-equivalent estimate** and is labelled as
such in the UI. Cache savings are computed from the same public table.

## Timing

Estimated active time counts gaps of 15 minutes or less between genuine recorded
activity events. Longer gaps are excluded entirely. Overlapping sessions within
a repository count once, including linked worktrees. Period totals are clipped
to the selected local calendar days; lifetime totals use all recorded sessions.
This estimates AI-session activity, rather than all work in your editor.

Session elapsed time spans the first and last genuine activity timestamps,
including breaks. Administrative records, injected context, and timestamps
inferred from file metadata do not contribute to timing. Fewer than two usable
activity timestamps means active and elapsed time are unavailable. Coverage
shows how many sessions have sufficient timing data; partial totals exclude
unavailable sessions.

Codex completion events can supply turn duration and time to first token.
OpenCode messages can supply response duration from explicit creation and
completion timestamps. These durations may include tools and other agent work.
Interrupted and failed observations remain visible in session details but are
excluded from completed-duration averages. Each timing kind is averaged
separately, with its sample count; period averages use completion dates.
API request latency is never inferred from chat timestamps. Sources without
explicit API timing show it as unavailable. The current Antigravity reader
exposes no per-message timestamps and therefore has no usable timing data.
Timing is calculated locally from existing files and read-only database access;
SessionPal does not intercept requests or change agent settings.

## Limitations

- Session formats are unofficial and can change between agent releases. Parsers
  are defensive, but unknown fields are ignored rather than guessed.
- Token usage is only available where the agent recorded it. A session without
  usage metadata shows tokens as unknown rather than inventing numbers.
- Daily usage charts place tokens on the day each message was recorded.
  Database-backed OpenCode and Antigravity only store session totals, so their
  usage is shown on the day the session was last active, and the chart says so.
- Cursor transcripts depend on the shape of its internal key-value database.
- Restoring a backup only writes back files that are missing. Existing files,
  including sessions that continued after the backup, are never overwritten,
  and no agent database (Cursor, OpenCode, Antigravity) is ever restored.
- SessionPal is not affiliated with Anthropic, OpenAI, Cursor, OpenCode or Google.

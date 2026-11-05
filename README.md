# SessionPal

A calm, local-first library for the AI coding sessions already on your machine.

Website: [sessionpal.app](https://sessionpal.app) · Made by [Subhojit Karmakar](https://essjaykay.dev)

SessionPal discovers, browses, exports, backs up and cleans up conversations from
**Claude Code**, **Codex**, **Cursor**, **OpenCode** and **Google Antigravity**. It runs entirely on your
computer: no account, no cloud, no telemetry, no background sync.

The interface is a React browser preview with a complete deterministic demo
library, plus a Tauri 2 desktop build that reads and operates on real local files.

## What it does

- **Discover** sessions from each agent's local storage automatically.
- **Browse** titles, projects, branches, models, token usage and complete
  transcripts, including tool calls and tool results.
- **Estimate cost** locally from published API list prices, clearly labelled
  `Est.` because it is an API-equivalent estimate, not a bill.
- **Export** one or many conversations as Markdown or JSON.
- **Back up** selected agents into portable ZIP archives with a manifest,
  README and session index.
- **Restore** archives safely: validate every entry, stage the extraction, and
  write back only files that are missing. Existing files are never overwritten.
- **Delete** individual sessions or a selection, with explicit confirmation and
  strict path validation.
- **Manage** storage by agent and inspect where everything lives.

## Privacy and safety

- Nothing is uploaded. There is no remote API, analytics, crash reporting or
  update check in the app.
- The browser preview uses deterministic sample data and labels itself as such.
- All destructive actions happen only in the desktop app, after confirmation.
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

## Interface

Six pages share the same warm paper workspace and charcoal icon rail:

- **Overview** — library at a glance, recent sessions, storage and activity.
- **Sessions** — searchable, filterable list with a full transcript reader.
- **Usage & cost** — tokens, model breakdown, cache savings and estimates.
- **Backups** — create, import, inspect, export, restore and delete archives.
- **Management** — storage by agent and bulk cleanup.
- **Settings** — appearance, motion, export defaults, diagnostics and paths.

Light, dark and system themes are included, with keyboard navigation, a command
palette (`⌘K` / `Ctrl+K`). The desktop window uses the platform's native window
controls; on macOS the title bar is transparent and overlays the app.

## Development

### Prerequisites

- Node.js 20 or newer
- Rust 1.77.2 or newer
- Tauri 2 system prerequisites for your OS (see
  <https://v2.tauri.app/start/prerequisites/>)

### Browser preview

```bash
npm install
npm run dev
```

Open <http://localhost:1420>. The preview loads a deterministic demo library of
2,846 sessions. Native-only actions show an honest explanatory toast.

### Desktop app

```bash
npm run tauri:dev
```

Build an installer:

```bash
npm run tauri:build
```

The frontend can also be checked independently:

```bash
npx tsc --noEmit
npm run build
```

Rust checks and parser tests:

```bash
cd src-tauri
cargo check
cargo test
```

## Repository layout

```
src/
  components/     App shell, navigation, dialogs, reader and UI primitives
  pages/          Overview, Sessions, Usage, Backups, Manage, Settings
  lib/
    store.tsx     Central application state and native action flows
    native.ts     Typed Tauri command bridge
    demo.ts       Deterministic sample library
    pricing.ts    Public API price table for local estimates
    exporting.ts  Browser exports and sample backup ZIPs
src-tauri/
  src/agents/     Claude, Codex, Cursor, OpenCode and Antigravity discovery and parsing
  src/backup.rs   ZIP creation, manifests, validation, staged restore
  src/export.rs   Markdown and JSON exports
  src/paths.rs    Agent root discovery and path validation
  src/pricing.rs  Rust mirror of the public price table
  src/tests.rs    Parser, Cursor read-only and restore-safety tests
```

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

`src/lib/pricing.ts` mirrors the published API list prices used by the Rust
backend. SessionPal does not know your subscription, credits, or provider
billing. Every amount shown is an **API-equivalent estimate** and is labelled as
such in the UI. Cache savings are computed from the same public table.

## Limitations

- Session formats are unofficial and can change between agent releases. Parsers
  are defensive, but unknown fields are ignored rather than guessed.
- Token usage is only available where the agent recorded it. A session without
  usage metadata shows tokens as unknown rather than inventing numbers.
- Cursor transcripts depend on the shape of its internal key-value database.
- Restoring a backup replaces the files listed in its manifest. Other sessions
  are untouched; Cursor's database is replaced as a whole.
- SessionPal is not affiliated with Anthropic, OpenAI, Cursor, OpenCode or Google.

## Contributing

Issues and pull requests are welcome. Please keep the privacy model intact:
new features must work locally, avoid background network access, and never add
a destructive action without confirmation and path validation. Run the
TypeScript build and `cargo test` before opening a pull request.

## Version history

See [CHANGELOG.md](CHANGELOG.md). The app shows the same history under
Settings → About.

## License

MIT. See [LICENSE](LICENSE).

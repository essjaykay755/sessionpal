# Changelog

All notable changes to SessionPal are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The app reads this file to show its version history, so keep the headings in
the `## [version] - YYYY-MM-DD` form.

## [0.1.0] - 2026-11-05

First release.

### Added

- Discovers local sessions from Claude Code, Codex, Cursor, OpenCode and Google Antigravity.
- Full transcripts with tool calls, code blocks, tables and lists.
- Search by title, project, folder, branch and model, with agent and project filters.
- Usage and estimated API cost, with cache reads counted separately.
- Markdown and JSON export for one session or a whole selection.
- ZIP backups with a manifest, plus importing archives from another machine.
- Bulk cleanup with confirmation and path checks.
- Light, dark and system appearance.

### Security

- Restores only add missing files and never overwrite existing ones.
- Restores refuse paths that leave an agent's storage folder, including through symlinks.
- Cursor is read-only. Its backups copy only chat rows, never settings or sign-in tokens.
- A strict content security policy, with no network access from the app.

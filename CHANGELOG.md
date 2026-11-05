# Changelog

All notable changes to SessionPal are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The app reads this file to show its version history, so keep the headings in
the `## [version] - YYYY-MM-DD` form.

## [0.3.0] - 2026-11-06

See what each project costs, and choose what SessionPal reads before it reads it.

### Added

- Cost by project on the Usage page: est. cost, tokens, share, a daily trend and change from the previous period for every project, with sorting and a filter.
- A project view with daily spend, cost by model and by agent, and the most expensive sessions, linking to them in Sessions.
- Sessions can be sorted by estimated cost, and filtering by a project shows its all-time sessions, tokens and cost.
- First-launch setup finds the installed agents and lets you choose which to include before anything is scanned.
- On macOS, setup explains project folder access first, then lets macOS ask for Documents, Desktop, Downloads, iCloud Drive or external drives. Folders you skip are never read.
- Settings has a switch for each agent and a Project folders section to allow or stop reading each protected folder.
- A notice appears when macOS blocks a folder you allowed, with a shortcut to System Settings.
- The About section links to the source code on GitHub.

### Changed

- Projects are grouped by git repository: subfolders and worktrees count toward their repository, and two repositories with the same folder name are shown separately.
- Top projects on the Usage page follows the Tokens / Est. cost switch.
- Backups and opening a single conversation no longer read project folders.
- The About section shows the logo on its own, without a tile.

## [0.2.0] - 2026-11-05

More accurate usage numbers, recoverable deletes and clearer backups.

### Added

- Daily usage charts place tokens on the day each message was sent, not the day a session was last updated.
- Backups show which conversations can be restored and which are archive only.
- Continuous integration builds the app and runs the tests on macOS and Windows.

### Changed

- Deleted sessions and backups move to the Trash (Recycle Bin on Windows), so they can be put back.
- Usage totals for a period count only the tokens used in that period, so long sessions are split across periods.
- Token totals now include cache writes.
- Overview counts new sessions by when they were created.
- The frontend and the backend now read prices from one shared catalog.
- Dark mode uses a neutral graphite palette with clearer layers, and status colours are consistent everywhere.
- The cost estimates guide has an aligned price table grouped by provider.

### Fixed

- "Reveal in Finder" reads "Show in Explorer" on Windows.
- The Settings button is centred in the collapsed sidebar.
- The Rescan icon no longer wobbles while spinning.
- The README now describes restores correctly.

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

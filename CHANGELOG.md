# Changelog

All notable changes to SessionPal are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The app reads this file to show its version history, so keep the headings in
the `## [version] - YYYY-MM-DD` form.

## [0.5.5] - 2026-11-11

### Changed

- Refined the Usage & cost dashboard with four aligned summary cards and the original metric color tones.
- Applied consistent rounded section tabs across Usage, Settings, and session details.

### Fixed

- Identify model creators using current catalog metadata, including newly listed models, while leaving ambiguous matches unknown.

## [0.5.4] - 2026-11-07

### Fixed

- Keep the session list hidden in focus mode, including after switching conversations, and restore the list when returning from a conversation on a narrow window.

## [0.5.3] - 2026-11-07

### Changed

- Show the app version beside the SessionPal name in the expanded sidebar.
- Extend the Windows window controls to fill the title bar height.

### Fixed

- Reveal detected agent paths that start with `~` in Finder or Explorer.

## [0.5.2] - 2026-11-06

### Added

- Added GitHub, website and Buy Me a Coffee links to the title bar, plus a support link in About and the README.
- Added a light and dark appearance switch to first-run setup.

### Changed

- Gave the Windows sidebar a little more space above the logo and navigation.

## [0.5.1] - 2026-11-06

### Changed

- Show prices for the models found in your sessions, including which agents used each model and whether its rate came from models.dev or the app's saved catalog.
- Mark models without a known price as unpriced and retain the long-context pricing note for Claude Haiku 5.5.

## [0.5.0] - 2026-11-06

Keep SessionPal current and navigate the desktop app more comfortably.

### Added

- Automatically check GitHub Releases for signed updates on macOS and Windows. Download and install an available update from the sidebar; automatic checks can be disabled in Settings.
- Check for updates manually, follow download progress, and retry or open GitHub Releases when an update fails.
- Refresh model pricing from a public catalog, with bundled prices as a fallback and paid-equivalent estimates for recognized free OpenCode models.

### Changed

- Integrated Windows window controls into the app header and removed the unused space above the sidebar logo. macOS keeps its native window controls.
- Aligned first-launch setup indicators across steps and kept them visible while longer steps scroll.
- Clarified pricing estimates and disclosed update checks in the privacy information.
- Publish signed updater packages and version-specific release notes alongside installers.

### Fixed

- Keep usage estimates and cached scans consistent when the live pricing catalog changes.
- Preserve wrapped changelog entries in the About version history.

## [0.4.2] - 2026-11-06

### Changed

- Moved the sidebar toggle to the title bar beside the sidebar, where it stays available as the sidebar opens and closes.
- Organized Settings into General, Agents & folders, Storage & search, Privacy, and About sections.
- Split Usage & cost into Overview, Projects, and Models & agents, with the selected date range shared across sections.
- Redesigned the privacy section and replaced the About page's website links with a compact row of icons.

## [0.4.1] - 2026-11-06

### Changed

- Updated SessionPal's logo throughout the app and desktop icons.

## [0.4.0] - 2026-11-06

Search what was said, not just session titles.

### Added

- Search finds conversations by what you and the agents wrote, across Claude Code, Codex, Cursor, OpenCode and Antigravity. Every word must appear in the same message; words match the start of a word, so unfinished words work, while a single letter matches only itself.
- Matching sessions show the passage that matched, with the words marked and a count of matching messages.
- Results include every matching conversation and refresh on their own while the index is built or after a rescan.
- Opening a match scrolls the conversation to that message and marks the words in it.
- Settings shows how many conversations are searchable and the index size, with a button to rebuild it.

### Changed

- The text index lives in SessionPal's cache folder on this device and updates in the background after each scan, rereading only conversations that changed. Tool output and context added by the agents are not indexed.
- Manage's search also matches conversation text.

## [0.3.2] - 2026-11-06

Opening SessionPal no longer rereads your whole library.

### Changed

- The library from the last scan appears as soon as the app opens, and a fresh scan runs in the background.
- Scans only reread conversations that changed since the last one, including after a restart. This covers Claude Code, Codex, Cursor, OpenCode and Antigravity.

## [0.3.1] - 2026-11-06

### Fixed

- Sign the complete macOS app bundle ad hoc so its signature passes integrity checks. The app is not notarized and macOS may still require manual approval.

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

# Developing SessionPal

[← Back to README](../README.md)

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

Open <http://localhost:1420>. The preview loads a deterministic demo library of sample sessions. Native-only actions show an honest explanatory toast.

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

## Contributing

Issues and pull requests are welcome. Please keep the privacy model intact:
new features must work locally, keep network access limited to public pricing and GitHub release updates, and never add
a destructive action without confirmation and path validation. Run the
TypeScript build and `cargo test` before opening a pull request.

## Publishing signed updates

Existing installations need to install the first updater-enabled release manually. Subsequent published stable releases can be installed in the app. Release builds require a persistent Tauri updater signing key, separate from platform code signing. Generate it once with `npx tauri signer generate -w <secure-key-path>` and keep a secure backup; losing it prevents existing installations from trusting future updates.

Set the full private key contents as the GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`, its password as the secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty if none), and the full public key contents as the repository variable `TAURI_UPDATER_PUBLIC_KEY`. Use the same key for every release. The release workflow embeds the public key in builds, signs the update packages, validates that all three platforms are present, and publishes their manifest and installers together. Never commit the private key. Local builds without this release configuration do not have a trusted update key. macOS app bundles must be installed in a writable location such as Applications; ad hoc signing and Windows SmartScreen warnings still apply.

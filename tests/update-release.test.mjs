import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/prepare-update-release.mjs', import.meta.url));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sessionpal-update-'));
  const input = join(root, 'input');
  for (const [folder, installer, update] of [
    ['macos-apple-silicon', 'app.dmg', 'SessionPal.app.tar.gz'],
    ['macos-intel', 'app.dmg', 'SessionPal.app.tar.gz'],
    ['windows-x64', 'app-setup.exe', 'app-setup.exe'],
  ]) {
    const dir = join(input, folder, 'bundle');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, installer), 'installer');
    writeFileSync(join(dir, update), 'update');
    writeFileSync(join(dir, `${update}.sig`), `signature-${folder}`);
  }
  return { root, input, output: join(root, 'output') };
}
function run(f) { return spawnSync(process.execPath, [script, f.input, f.output, '1.2.3', 'owner/repo'], { encoding: 'utf8' }); }

test('packages a complete, platform-specific signed update manifest', () => {
  const f = fixture();
  try {
    const result = run(f);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(join(f.output, 'latest.json'), 'utf8'));
    assert.equal(manifest.version, '1.2.3');
    assert.deepEqual(Object.keys(manifest.platforms).sort(), ['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64']);
    for (const item of Object.values(manifest.platforms)) {
      assert.match(item.signature, /^signature-/);
      const asset = decodeURIComponent(item.url.split('/').at(-1));
      assert.ok(readFileSync(join(f.output, asset)).length);
      assert.equal(readFileSync(join(f.output, `${asset}.sig`), 'utf8'), item.signature);
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('refuses to publish when a platform signature is missing', () => {
  const f = fixture();
  try {
    rmSync(join(f.input, 'macos-intel', 'bundle', 'SessionPal.app.tar.gz.sig'));
    assert.notEqual(run(f).status, 0);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

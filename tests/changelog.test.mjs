import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const bundle = await build({ entryPoints: ['src/lib/about.ts'], bundle: true, platform: 'node', format: 'esm', write: false, loader: { '.md': 'text' } });
const { RELEASES, parseChangelog, APP_INFO } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('About shows every version and changelog item with Windows and Unix line endings', () => {
  const source = readFileSync('CHANGELOG.md', 'utf8');
  const unix = parseChangelog(source.replace(/\r\n/g, '\n'));
  const windows = parseChangelog(source.replace(/\r?\n/g, '\r\n'));
  assert.deepEqual(windows, unix);
  assert.deepEqual(RELEASES, unix);
  assert.equal(unix[0].version, APP_INFO.version);
  assert.equal(unix[0].sections.flatMap((section) => section.items).length, 9);
  assert.ok(unix.some((release) => release.version === '0.4.0' && release.sections.some((section) => section.items.length === 5)));
});

test('About preserves wrapped list items with CRLF endings', () => {
  const [entry] = parseChangelog('## [1.0.0] - 2026-11-06\r\n\r\n### Fixed\r\n\r\n- First part\r\n  continued here.\r\n- Second item.\r\n');
  assert.deepEqual(entry.sections[0].items, ['First part continued here.', 'Second item.']);
});

test('release notes come from the same version of the changelog', () => {
  const result = spawnSync(process.execPath, ['scripts/release-notes.mjs', APP_INFO.version], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const section of RELEASES[0].sections) {
    for (const item of section.items) assert.ok(result.stdout.includes(item), `Missing: ${item}`);
  }
  assert.ok(!result.stdout.includes('## [0.4.2]'));
  assert.notEqual(spawnSync(process.execPath, ['scripts/release-notes.mjs', '99.99.99']).status, 0);
});

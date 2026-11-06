import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [input, output, version, repository] = process.argv.slice(2);
if (!input || !output || !/^\d+\.\d+\.\d+$/.test(version ?? '') || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) {
  throw new Error('Usage: node prepare-update-release.mjs <artifacts> <output> <stable-version> <owner/repo>');
}
function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}
function exactlyOne(files, predicate, description) {
  const found = files.filter(predicate);
  if (found.length !== 1) throw new Error(`Expected one ${description}, found ${found.length}`);
  return found[0];
}
mkdirSync(output, { recursive: true });
const platforms = {};
for (const [folder, target, name, installerExtension, updateExtension] of [
  ['macos-apple-silicon', 'darwin-aarch64', 'macos-apple-silicon', '.dmg', '.app.tar.gz'],
  ['macos-intel', 'darwin-x86_64', 'macos-intel', '.dmg', '.app.tar.gz'],
  ['windows-x64', 'windows-x86_64', 'windows-x64', '-setup.exe', '-setup.exe'],
]) {
  const files = filesUnder(join(input, folder));
  const installer = exactlyOne(files, (f) => f.endsWith(installerExtension), `${name} installer`);
  const update = exactlyOne(files, (f) => f.endsWith(updateExtension), `${name} updater`);
  const sig = exactlyOne(files, (f) => f === `${update}.sig`, `${name} signature`);
  const signature = readFileSync(sig, 'utf8').trim();
  if (!signature) throw new Error(`Empty signature for ${name}`);
  const installerName = `SessionPal-${version}-${name}${installerExtension === '.dmg' ? '.dmg' : '-setup.exe'}`;
  const updateName = update === installer ? installerName : `SessionPal-${version}-${name}.app.tar.gz`;
  copyFileSync(installer, join(output, installerName));
  if (update !== installer) copyFileSync(update, join(output, updateName));
  copyFileSync(sig, join(output, `${updateName}.sig`));
  platforms[target] = { signature, url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(updateName)}` };
}
writeFileSync(join(output, 'latest.json'), `${JSON.stringify({ version, pub_date: new Date().toISOString(), platforms }, null, 2)}\n`);

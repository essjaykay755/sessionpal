import { readFileSync } from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Expected a stable version, e.g. 0.5.0');
const changelog = readFileSync('CHANGELOG.md', 'utf8').replace(/\r\n/g, '\n');
const releases = [...changelog.matchAll(/^## \[([^\]]+)\] - \d{4}-\d{2}-\d{2}\s*$/gm)];
const index = releases.findIndex((match) => match[1] === version);
if (index < 0 || releases.filter((match) => match[1] === version).length !== 1) {
  throw new Error(`Expected exactly one changelog entry for ${version}`);
}
const entry = changelog.slice(releases[index].index + releases[index][0].length, releases[index + 1]?.index).trim();
if (!entry) throw new Error(`Changelog entry for ${version} is empty`);
process.stdout.write(`${entry}\n\n---\n\nDownload the installer for your system below. macOS builds are ad hoc signed but not notarized; Windows builds are unsigned and may trigger SmartScreen. macOS requires version 11 or later.\n`);

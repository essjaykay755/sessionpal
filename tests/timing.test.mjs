import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { timingStats, timingDuration } = await load('src/lib/timing.ts');
const { projectCostStats } = await load('src/lib/analytics.ts');
const base = new Date('2026-11-05T09:00:00').getTime();
const iso = (ms) => new Date(ms).toISOString();
const session = (id, start = base, end = base + 600_000, overrides = {}) => ({
  id, agent: 'codex', project: 'demo', projectRoot: '/demo', projectLabel: 'Demo',
  createdAt: iso(start), updatedAt: iso(end), models: [], model: null, usage: null,
  tokens: 0, usageDays: [], tint: 'sage', icon: 'Folder',
  timing: { activityIntervals: [{ startMs: start, endMs: end }], eventCount: 2,
    firstActivity: iso(start), lastActivity: iso(end), elapsedMs: end - start, entries: [] },
  ...overrides,
});
const entry = (id, kind, durationMs, status = 'completed', ttft = null) => ({
  id, source: 'test', kind, durationMs, status, timestamp: iso(base + 5000), timeToFirstTokenMs: ttft,
});

test('project activity is the union of overlapping and nested sessions', () => {
  const sessions = [session('a'), session('b', base + 300_000, base + 900_000), session('c', base + 100_000, base + 200_000)];
  assert.equal(timingStats(sessions).activeMs, 900_000);
});

test('unknown time is unavailable; long breaks with sufficient events yield known zero', () => {
  const unavailable = session('a', base, base, { timing: null });
  assert.equal(timingStats([unavailable]).activeMs, null);
  const single = session('b');
  single.timing.eventCount = 1;
  single.timing.activityIntervals = [];
  assert.equal(timingStats([single]).activeMs, null);
  single.timing.eventCount = 2;
  assert.equal(timingStats([single]).activeMs, 0);
  const stats = timingStats([session('known'), unavailable]);
  assert.equal(stats.activeMs, 600_000);
  assert.equal(stats.coveredSessions, 1);
  assert.equal(stats.totalSessions, 2);
});

test('intervals clip at local calendar boundaries, including the end of a range', () => {
  const midnight = new Date('2026-11-05T00:00:00').getTime();
  const next = new Date('2026-11-06T00:00:00').getTime();
  const stats = timingStats([
    session('start', midnight - 300_000, midnight + 300_000),
    session('end', next - 300_000, next + 300_000),
  ], { from: '2026-11-05', to: '2026-11-05' });
  assert.equal(stats.activeMs, 600_000);
});

test('averages separate timing kinds, deduplicate entries and exclude interruptions and errors', () => {
  const s = session('a');
  s.timing.entries = [entry('a', 'turn', 1000, 'completed', 100), entry('a', 'turn', 1000),
    entry('b', 'turn', 3000, 'completed', 300), entry('c', 'turn', 90000, 'interrupted'),
    entry('d', 'response', 4000), entry('e', 'api', 500), entry('f', 'api', 9000, 'error'),
    entry('g', 'turn', -10), entry('h', 'api', NaN)];
  const averages = timingStats([s]).averages;
  assert.deepEqual(averages.map(({kind, count, averageMs}) => [kind, count, averageMs]), [
    ['turn', 2, 2000], ['response', 1, 4000], ['api', 1, 500],
  ]);
  assert.equal(averages[0].averageFirstTokenMs, 200);
  s.timing.entries.push({ ...entry('outside', 'turn', 100000), timestamp: '2026-11-06T12:00:00Z' });
  assert.equal(timingStats([s], { from: '2026-11-05', to: '2026-11-05' }).averages[0].count, 2);
});

test('project analytics include timing-only projects, group worktrees, and calculate lifetime separately', () => {
  const today = session('today');
  const parallel = session('worktree', base + 300_000, base + 900_000, { project: 'other-worktree', cwd: '/demo-worktree' });
  const past = session('past', base - 86400_000, base - 86400_000 + 600_000);
  const other = session('other', base, base + 600_000, { projectRoot: '/other' });
  const all = [today, parallel, past, other];
  const stats = projectCostStats(all, { from: '2026-11-05', to: '2026-11-05' }, all);
  assert.equal(stats.length, 2);
  const project = stats.find((s) => s.key === 'root:/demo');
  assert.equal(project.tokens, 0);
  assert.equal(project.sessions, 2);
  assert.equal(project.timing.activeMs, 900_000);
  assert.equal(project.lifetimeTiming.activeMs, 1500_000);
  assert.equal(project.lifetimeTiming.firstActivity, past.timing.firstActivity);
});

test('duration formatting preserves zero and subsecond measurements and rejects missing values', () => {
  assert.equal(timingDuration(null), 'Unavailable');
  assert.equal(timingDuration(NaN), 'Unavailable');
  assert.equal(timingDuration(0), '0 ms');
  assert.equal(timingDuration(123), '123 ms');
  assert.equal(timingDuration(1250), '1.3 s');
  assert.equal(timingDuration(3660_000), '1h 1m');
});

test('fictional examples include recorded and interrupted timing with consistent summary/detail dates', async () => {
  const { DEMO_SESSIONS, demoSessionDetail } = await load('src/lib/demo.ts');
  const featured = demoSessionDetail('ses_prepapp_onboarding');
  assert.equal(featured.timing.elapsedMs, Date.parse(featured.updatedAt) - Date.parse(featured.createdAt));
  assert.ok(featured.timing.entries.some((entry) => entry.status === 'completed'));
  assert.ok(featured.timing.entries.some((entry) => entry.status === 'interrupted'));
  for (const message of featured.messages) {
    assert.ok(Date.parse(message.timestamp) >= Date.parse(featured.createdAt));
    assert.ok(Date.parse(message.timestamp) <= Date.parse(featured.updatedAt));
  }
  assert.ok(DEMO_SESSIONS.some((session) => !session.timing));
  assert.ok(DEMO_SESSIONS.some((session) => session.timing?.eventCount === 1));
  assert.deepEqual(DEMO_SESSIONS.find((session) => session.id === featured.id).timing, featured.timing);
});

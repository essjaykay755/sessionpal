import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(entry) {
  const bundle = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}

const cal = await load('src/lib/modelCalendar.ts');
const analytics = await load('src/lib/analytics.ts');

function makeSession(overrides = {}) {
  return {
    id: overrides.id ?? 'ses_1',
    agent: overrides.agent ?? 'claude',
    title: overrides.title ?? 'Test session',
    excerpt: '',
    project: 'demo',
    projectLabel: 'Demo',
    cwd: '/tmp/demo',
    branch: null,
    createdAt: overrides.createdAt ?? '2026-11-20T09:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-11-20T10:00:00.000Z',
    messageCount: 4,
    tokens: overrides.tokens ?? 0,
    sizeBytes: 1024,
    model: overrides.model ?? null,
    models: overrides.models ?? [],
    usage: overrides.usage ?? null,
    usageDays: overrides.usageDays,
    modelUsage: overrides.modelUsage,
    format: 'jsonl',
    path: '/tmp/demo.jsonl',
    deletable: true,
    tint: 'sage',
    icon: 'Folder',
  };
}

test('buildYearMonths aligns ISO Monday-start weeks inside each month', () => {
  const months2026 = cal.buildYearMonths(2026);
  assert.equal(months2026.length, 12);

  // May 1, 2026 is Friday (weekday index 4)
  const may = months2026[4];
  assert.equal(may.name, 'May');
  assert.deepEqual(may.weeks[0], [null, null, null, null, '2026-05-01', '2026-05-02', '2026-05-03']);
  assert.equal(may.weeks[may.weeks.length - 1][6], '2026-05-31');

  // June 1, 2026 is Monday (weekday index 0)
  const june = months2026[5];
  assert.equal(june.weeks[0][0], '2026-06-01');
  assert.deepEqual(june.weeks[june.weeks.length - 1], ['2026-06-29', '2026-06-30', null, null, null, null, null]);

  // November 1, 2026 is Sunday (weekday index 6)
  const nov = months2026[10];
  assert.deepEqual(nov.weeks[0], [null, null, null, null, null, null, '2026-11-01']);

  // Leap year Feb 2024 has 29 days
  const feb2024 = cal.buildYearMonths(2024)[1];
  const febDays = feb2024.weeks.flat().filter(Boolean);
  assert.equal(febDays.length, 29);
  assert.equal(febDays[28], '2024-02-29');
});

test('aggregates per-day per-model records across dated, Antigravity modelUsage, and legacy sessions', () => {
  const sessions = [
    makeSession({
      id: 'claude-multi',
      agent: 'claude',
      model: 'claude-opus-5-5',
      models: ['claude-opus-5-5', 'claude-sonnet-5-5'],
      usage: { input: 1500, output: 500, cacheRead: 1000, cacheWrite: 0, cost: 0.02 },
      usageDays: [
        {
          day: '2026-11-20',
          input: 1500,
          output: 500,
          cacheRead: 1000,
          cacheWrite: 0,
          cost: 0.02,
          models: [
            { model: 'claude-opus-5-5', input: 1000, output: 400, cacheRead: 1000, cacheWrite: 0, cost: 0.015 },
            { model: 'claude-sonnet-5-5', input: 500, output: 100, cacheRead: 0, cacheWrite: 0, cost: 0.005 },
          ],
        },
      ],
    }),
    makeSession({
      id: 'ag-multi',
      agent: 'antigravity',
      updatedAt: '2026-11-21T12:00:00.000Z',
      model: 'gemini-4-neon',
      models: ['gemini-4-neon', 'claude-opus-5-5'],
      usage: { input: 2000, output: 800, cacheRead: 0, cacheWrite: 0, cost: 0.03 },
      modelUsage: [
        { model: 'gemini-4-neon', input: 1200, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.0111 },
        { model: 'claude-opus-5-5', input: 800, output: 300, cacheRead: 0, cacheWrite: 0, cost: 0.0189 },
      ],
    }),
    makeSession({
      id: 'opencode-legacy',
      agent: 'opencode',
      updatedAt: '2026-11-22T09:00:00.000Z',
      model: 'kimi-k2',
      models: ['kimi-k2'],
      usage: { input: 500, output: 200, cacheRead: 0, cacheWrite: 0, cost: 0.0008 },
    }),
  ];

  const palette = cal.buildModelPalette(sessions);
  const index = cal.buildCalendarIndex(sessions, palette);

  const day20 = index.get('2026-11-20');
  assert.ok(day20);
  assert.equal(day20.tokens, 3000);
  assert.equal(day20.models.length, 2);
  assert.equal(day20.models[0].id, 'claude-opus-5-5');
  assert.equal(day20.models[0].tokens, 2400);
  assert.equal(day20.models[1].id, 'claude-sonnet-5-5');
  assert.equal(day20.models[1].tokens, 600);

  const day21 = index.get('2026-11-21');
  assert.ok(day21);
  assert.equal(day21.models.length, 2);
  assert.equal(day21.models[0].id, 'gemini-4-neon');
  assert.equal(day21.models[1].id, 'claude-opus-5-5');

  // Filtering to a single model isolates only that model's days and totals.
  const opusOnly = cal.buildCalendarIndex(sessions, palette, { modelId: 'claude-opus-5-5' });
  assert.equal(opusOnly.size, 2);
  assert.equal(opusOnly.get('2026-11-20').tokens, 2400);
  assert.equal(opusOnly.get('2026-11-21').tokens, 1100);
  assert.equal(opusOnly.get('2026-11-22'), undefined);

  // modelStats breaks down multi-model sessions accurately without collapsing to "Multiple models".
  const stats = analytics.modelStats(sessions, { from: '2026-11-01', to: '2026-11-30' });
  assert.equal(stats.some((s) => s.id === '__multiple_models__'), false);
  assert.equal(stats.find((s) => s.id === 'claude-opus-5-5').tokens, 3500);
  assert.equal(stats.find((s) => s.id === 'claude-opus-5-5').sessions, 2);
  assert.equal(stats.find((s) => s.id === 'gemini-4-neon').tokens, 1700);
  assert.equal(stats.find((s) => s.id === 'kimi-k2').tokens, 700);
});

test('computeStreaks handles active streaks ending today, yesterday, and broken streaks', () => {
  const days = ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'];
  const sessions = days.map((day, idx) =>
    makeSession({
      id: `s-${idx}`,
      model: 'claude-opus-5-5',
      models: ['claude-opus-5-5'],
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.001 },
      usageDays: [
        {
          day,
          input: 100,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0.001,
          models: [{ model: 'claude-opus-5-5', input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.001 }],
        },
      ],
    }),
  );
  const palette = cal.buildModelPalette(sessions);
  const index = cal.buildCalendarIndex(sessions, palette);

  // On Nov 21 (active today): streak = 4
  const onDay = cal.computeStreaks(index, '2026-01-01', '2026-12-31', new Date(2026, 10, 21, 14, 0).getTime());
  assert.equal(onDay.current, 4);
  assert.equal(onDay.longest, 4);

  // On Nov 22 (yesterday was active, today hasn't logged yet): streak still 4
  const nextMorning = cal.computeStreaks(index, '2026-01-01', '2026-12-31', new Date(2026, 10, 22, 9, 0).getTime());
  assert.equal(nextMorning.current, 4);

  // On Nov 23 (missed Nov 22): current streak = 0, longest remains 4
  const broken = cal.computeStreaks(index, '2026-01-01', '2026-12-31', new Date(2026, 10, 23, 9, 0).getTime());
  assert.equal(broken.current, 0);
  assert.equal(broken.longest, 4);
});

test('buildModelPalette avoids color collisions and dayCellBackground splits multi-model days', () => {
  const modelIds = [
    'claude-opus-5-5',
    'claude-opus-4-5',
    'gpt-6.1-terra',
    'gpt-6.2-sol',
    'gpt-6.1-sol',
    'gpt-5.6-luna',
    'codex-auto-review',
    ...Array.from({ length: 22 }, (_, i) => `custom-model-${i}`),
  ];
  const sessions = modelIds.map((model, idx) =>
    makeSession({
      id: `m-${idx}`,
      agent: model.startsWith('gpt') || model.startsWith('codex') ? 'codex' : 'claude',
      model,
      models: [model],
      usage: { input: 5000 - idx * 50, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.02 },
    }),
  );
  const palette = cal.buildModelPalette(sessions);
  const colors = modelIds.map((id) => palette.get(id).color);
  // Every model gets a strictly unique hex color even beyond the base palette size.
  assert.equal(new Set(colors).size, modelIds.length);
  // Closely-shaded OpenAI variants (terra vs sol) must get clearly separated hues.
  const hexDist = (a, b) => {
    const parse = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const [r1, g1, b1] = parse(a);
    const [r2, g2, b2] = parse(b);
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
  };
  assert.ok(hexDist(palette.get('gpt-6.1-terra').color, palette.get('gpt-6.2-sol').color) >= 54);

  const colorA = palette.get('claude-opus-5-5').color;
  const colorB = palette.get('claude-opus-4-5').color;
  assert.equal(cal.dayCellBackground([{ color: colorA, share: 100 }]), colorA);
  const split = cal.dayCellBackground([
    { color: colorA, share: 65 },
    { color: colorB, share: 35 },
  ]);
  assert.ok(split.startsWith('linear-gradient(135deg,'));
  assert.ok(split.includes(colorA));
  assert.ok(split.includes(colorB));
});

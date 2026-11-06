import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/lib/live-pricing.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { parseLivePrices } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('free models use the explicitly paired paid price and retain their identity', () => {
  const prices = parseLivePrices({ opencode: { models: {
    'future-flash-free': { id: 'future-flash-free', name: 'Future Flash Free', canonical_model_id: 'lab/future-flash', cost: { input: 0, output: 0 } },
    'future-flash': { id: 'future-flash', canonical_model_id: 'lab/future-flash', cost: { input: 0.3, output: 1.2, cache_read: 0.006 } },
    'unmatched-free': { id: 'unmatched-free', cost: { input: 0, output: 0 } },
  } } });
  const free = prices.find((p) => p.id === 'future-flash-free');
  assert.equal(free.label, 'Future Flash Free');
  assert.deepEqual([free.input, free.output, free.cacheRead, free.cacheWrite], [0.3, 1.2, 0.006, 0.3]);
  assert.equal(prices.some((p) => p.id === 'unmatched-free'), false);
});

test('conflicting providers and incompatible canonical models remain unpriced', () => {
  const prices = parseLivePrices({ one: { models: {
    'x': { id: 'x', canonical_model_id: 'lab/x', cost: { input: 1, output: 2 } },
    'x-free': { id: 'x-free', canonical_model_id: 'lab/other', cost: { input: 0, output: 0 } },
  } }, two: { models: { 'x': { id: 'x', cost: { input: 2, output: 3 } } } } });
  assert.deepEqual(prices, []);
});

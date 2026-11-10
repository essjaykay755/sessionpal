import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/lib/live-pricing.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { parseLivePrices, parseModelMetadata, loadLivePrices } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const pricingBundle = await build({ entryPoints: ['src/lib/pricing.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { modelInfo, setLiveModels, setLiveMetadata, estimateUsage } = await import(`data:text/javascript;base64,${Buffer.from(pricingBundle.outputFiles[0].text).toString('base64')}`);

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

test('canonical metadata identifies the lab independently of pricing and hosting provider', () => {
  setLiveMetadata(parseModelMetadata({ providers: {
    anthropic: { name: 'Anthropic' },
    gateway: { name: 'Gateway', models: {
      'claude-fable-5-2': { id: 'claude-fable-5-2', canonical_model_id: 'anthropic/claude-fable-5-2' },
      'future-unpriced': { id: 'future-unpriced', canonical_model_id: 'newlab/future-unpriced' },
    } },
    newlab: { name: 'New Lab' },
  }, models: {
    'anthropic/claude-fable-5-2': { name: 'Claude Fable 5.2' },
    'newlab/future-unpriced': { name: 'Future Unpriced' },
  } }));
  setLiveModels(parseLivePrices({ gateway: { models: {
    'claude-fable-5-2': { id: 'claude-fable-5-2', cost: { input: 1, output: 5 } },
    'unrecognized-model': { id: 'unrecognized-model', cost: { input: 2, output: 4 } },
  } } }));
  const fable = modelInfo('claude-fable-5-2');
  assert.equal(fable.family, 'Anthropic');
  assert.equal(fable.input, 1);
  assert.equal(fable.output, 5);
  assert.equal(modelInfo('claude-fable-5-2-20261109').family, 'Anthropic');
  assert.equal(modelInfo('future-unpriced').family, 'New Lab');
  assert.equal(estimateUsage('future-unpriced', { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }).cost, null);
  assert.equal(modelInfo('unrecognized-model').family, 'Unknown');
  setLiveModels([]);
  setLiveMetadata([]);
});

test('ambiguous aliases do not get assigned a lab', () => {
  const metadata = parseModelMetadata({ providers: {
    a: { name: 'Lab A' }, b: { name: 'Lab B' },
    host: { models: { shared: { id: 'shared', canonical_model_id: 'a/first' } } },
    other: { models: { shared: { id: 'shared', canonical_model_id: 'b/second' } } },
  }, models: { 'a/first': { name: 'First' }, 'b/second': { name: 'Second' } } });
  assert.equal(metadata.some((m) => m.id === 'shared'), false);
  assert.equal(metadata.find((m) => m.id === 'a/first').family, 'Lab A');
});

test('an old pricing cache is retained when the catalog is offline', async () => {
  globalThis.localStorage = { getItem: (key) => key === 'sessionpal.model-prices.v1' ? JSON.stringify({ time: 1, prices: [{ id: 'old' }] }) : null };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try { assert.deepEqual(await loadLivePrices(), { prices: [{ id: 'old' }], metadata: [] }); }
  finally { globalThis.fetch = originalFetch; delete globalThis.localStorage; }
});

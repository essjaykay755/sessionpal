import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/lib/modelHistory.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { modelChanges, detectedModels } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const message = (id, role, model) => ({ id, role, model, content: '', timestamp: '' });

test('marks observed changes, including a return to an earlier model', () => {
  const messages = [message('1', 'assistant', 'a'), message('2', 'user'), message('3', 'assistant', 'b'), message('4', 'assistant', 'a')];
  assert.deepEqual([...modelChanges('codex', messages)], [['3', 'b'], ['4', 'a']]);
});

test('does not infer a switch across an unidentified response or for unsupported readers', () => {
  const messages = [message('1', 'assistant', 'a'), message('2', 'assistant'), message('3', 'assistant', 'b')];
  assert.equal(modelChanges('claude', messages).size, 0);
  const identified = [messages[0], messages[2]];
  assert.equal(modelChanges('cursor', identified).size, 0);
  assert.equal(modelChanges('antigravity', identified).size, 0);
});

test('lists unique detected models and preserves the summary model', () => {
  assert.deepEqual(detectedModels({ models: ['a', 'b', 'a'], model: 'c' }), ['a', 'b', 'c']);
  assert.deepEqual(detectedModels({ models: [], model: null }), []);
});

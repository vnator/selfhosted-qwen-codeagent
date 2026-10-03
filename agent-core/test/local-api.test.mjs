import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createLocalApi } from '../src/http/app.mjs';

const TOKEN = '0123456789abcdef0123456789abcdef0123456789abcdef';
const proposal = 'b9b1de2e-785c-45d2-b3ac-64df9ab9dda3';

async function withServer(fn, overrides = {}) {
  const calls = [];
  const handlers = {
    ask: async (value) => { calls.push(['ask', value]); return { answer: 'test', sources: [] }; },
    review: async (value) => { calls.push(['review', value]); return { answer: 'review' }; },
    propose: async (value) => { calls.push(['propose', value]); return { id: proposal, diff: '+test', relativePath: value.file }; },
    preview: async (value) => { calls.push(['preview', value]); return { id: value, diff: '+test' }; },
    ...overrides,
  };
  const api = createLocalApi({ token: TOKEN, handlers });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const url = `http://127.0.0.1:${api.address().port}`;
  try { await fn({ url, calls }); }
  finally { await new Promise((resolve, reject) => api.close(e => e ? reject(e) : resolve())); }
}
const auth = { authorization: `Bearer ${TOKEN}` };

test('API rejects unknown token, browser origins, and has no APPLY endpoint', async () => withServer(async ({ url }) => {
  assert.equal((await fetch(`${url}/v1/health`)).status, 401);
  assert.equal((await fetch(`${url}/v1/health`, { headers: { ...auth, origin: 'https://evil.example' } })).status, 403);
  const health = await (await fetch(`${url}/v1/health`, { headers: auth })).json();
  assert.equal(health.apply, 'interactive-cli-only');
  assert.equal((await fetch(`${url}/v1/edits/${proposal}/apply`, { method: 'POST', headers: auth })).status, 404);
}));

test('API forwards validated ASK, REVIEW, EDIT proposal and preview', async () => withServer(async ({ url, calls }) => {
  const post = (path, body) => fetch(`${url}${path}`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  let r = await post('/v1/ask', { question: 'Where is apply?', files: ['agent-core/cli.mjs'] });
  assert.equal(r.status, 200);
  assert.deepEqual(calls[0], ['ask', { question: 'Where is apply?', files: ['agent-core/cli.mjs'], context: 'none' }]);
  r = await post('/v1/review', { diff: 'change.diff' });
  assert.equal(r.status, 200);
  r = await post('/v1/edits/propose', { file: 'math.ts', instruction: 'Add a return type' });
  assert.equal((await r.json()).id, proposal);
  r = await fetch(`${url}/v1/edits/${proposal}`, { headers: auth });
  assert.equal((await r.json()).diff, '+test');
}));

test('API rejects invalid payload, oversized input and unsupported paths', async () => withServer(async ({ url }) => {
  const post = (path, body, headers = {}) => fetch(`${url}${path}`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json', ...headers }, body,
  });
  assert.equal((await post('/v1/ask', '{')).status, 400);
  assert.equal((await post('/v1/ask', JSON.stringify({ question: 'x'.repeat(17000) }))).status, 413);
  assert.equal((await post('/v1/ask', JSON.stringify({ question: 'x', files: [1] }))).status, 400);
  assert.equal((await post('/v1/edits/propose', JSON.stringify({ file: 'a' }))).status, 400);
  assert.equal((await fetch(`${url}/v1/edits/invalid`, { headers: auth })).status, 400);
}));

test('API refuses concurrent model operations', async () => {
  let release;
  const blocking = new Promise(resolve => { release = resolve; });
  let entered;
  const began = new Promise(resolve => { entered = resolve; });
  await withServer(async ({ url }) => {
    const post = () => fetch(`${url}/v1/ask`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'test', files: ['math.ts'] }),
    });
    const pending = post();
    await began;
    assert.equal((await post()).status, 429);
    release();
    assert.equal((await pending).status, 200);
  }, { ask: async () => { entered(); await blocking; return { answer: 'done', sources: [] }; } });
});

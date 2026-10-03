import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { openWorkspace } from '../src/workspace.mjs';
import { sha256 } from '../src/ingestion/files.mjs';
import { createContextProvider } from '../src/context/retriever.mjs';
import { createQdrant } from '../src/ingestion/clients.mjs';
import { ask } from '../src/runtime.mjs';

const repositoryId = 'selfhosted-qwen-codeagent';
const model = 'nomic-embed-text:latest';
const documentText = 'export function add(a, b) {\n  return a + b;\n}\n';
function hit(relativePath = 'example.js', content = documentText, overrides = {}) {
  return {
    score: 0.91,
    payload: {
      repository_id: repositoryId,
      embedding_model: model,
      relative_path: relativePath,
      start_line: 1,
      end_line: 3,
      source_hash: sha256(documentText),
      chunk_hash: sha256(content),
      content,
      ...overrides,
    },
  };
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'qwen-context-'));
  await writeFile(join(dir, 'example.js'), documentText);
  await writeFile(join(dir, '.env'), 'SECRET=NEVER_EMBED\n');
  await symlink(join(dir, '.env'), join(dir, 'leak.js'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  return { workspace: await openWorkspace(dir), dir };
}
function provider(workspace, points, extra = {}) {
  return createContextProvider({
    workspace,
    repositoryId,
    embedder: { model, async embed(query) { assert.deepEqual(query, ['Find add']); return [[1, 2, 3]]; } },
    qdrant: { async queryPoints(input) {
      assert.equal(input.repositoryId, repositoryId);
      assert.equal(input.embeddingModel, model);
      assert.deepEqual(input.vector, [1, 2, 3]);
      return points;
    } },
    ...extra,
  });
}
test('retrieval validates current source content and provides line provenance to ASK', async (t) => {
  const { workspace } = await fixture(t);
  const sources = await provider(workspace, [hit()]).retrieve('Find add');
  assert.equal(sources.length, 1);
  assert.equal(sources[0].relativePath, 'example.js');
  let captured;
  const result = await ask({
    workspace, question: 'Find add', contextSources: sources,
    client: { async complete(req) { captured = req; return 'In example.js'; } },
  });
  assert.equal(result, 'In example.js');
  assert.match(captured.user, /example\.js:L1-L3/);
  assert.match(captured.user, /export function add/);
  assert.doesNotMatch(captured.user, /NEVER_EMBED/);
  assert.match(captured.system, /untrusted data/);
});
test('retrieval excludes hits from another repository or embedding model even if backend returns them', async (t) => {
  const { workspace } = await fixture(t);
  const sources = await provider(workspace, [
    hit('example.js', documentText, { repository_id: 'unrelated' }),
    hit('example.js', documentText, { embedding_model: 'another-model' }),
    hit(),
  ]).retrieve('Find add');
  assert.equal(sources.length, 1);
});
test('retrieval excludes stale content, tampered chunks, private files and symlinks', async (t) => {
  const { workspace, dir } = await fixture(t);
  const points = [
    hit('example.js', documentText, { source_hash: 'outdated' }),
    hit('example.js', 'fake', { chunk_hash: 'not-a-hash' }),
    hit('.env', 'SECRET=NEVER_EMBED\n', { source_hash: sha256('SECRET=NEVER_EMBED\n'), start_line: 1, end_line: 1 }),
    hit('leak.js', 'SECRET=NEVER_EMBED\n', { source_hash: sha256('SECRET=NEVER_EMBED\n'), start_line: 1, end_line: 1 }),
    hit('../outside.js'),
  ];
  assert.deepEqual(await provider(workspace, points).retrieve('Find add'), []);
  await writeFile(join(dir, 'example.js'), 'const changed = 1;\n');
  assert.deepEqual(await provider(workspace, [hit()]).retrieve('Find add'), []);
});
test('retrieval respects output budget, limit and removes duplicate Qdrant entries', async (t) => {
  const { workspace } = await fixture(t);
  assert.equal((await provider(workspace, [hit(), hit()]).retrieve('Find add')).length, 1);
  assert.equal((await provider(workspace, [hit()], { maxContextBytes: 512 }).retrieve('Find add')).length, 1);
  const huge = documentText.repeat(30);
  assert.deepEqual(await provider(workspace, [hit('example.js', huge, {
    source_hash: sha256(huge), chunk_hash: sha256(huge), end_line: 90,
  })]).retrieve('Find add'), []);
  assert.throws(() => provider(workspace, [], { limit: 13 }), /limit/i);
  await assert.rejects(provider(workspace, []).retrieve(''), /question/i);
});
test('Qdrant query sends mandatory repository and embedding-model filters', async () => {
  let request;
  const q = createQdrant({ fetchImpl: async (url, opts) => {
    if (opts.method === 'GET') return { ok: true, json: async () => ({ result: { config: { params: { vectors: { size: 3, distance: 'Cosine' } } } } }) };
    request = { url, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ result: { points: [] } }) };
  } });
  assert.deepEqual(await q.queryPoints({ vector: [1, 2, 3], repositoryId, embeddingModel: model, limit: 5 }), []);
  assert.match(request.url, /\/collections\/code_chunks_node_v1\/points\/query$/);
  assert.deepEqual(request.body.filter.must, [
    { key: 'repository_id', match: { value: repositoryId } },
    { key: 'embedding_model', match: { value: model } },
  ]);
  assert.equal(request.body.with_vector, false);
  assert.equal(request.body.limit, 5);
});
test('ASK retains the explicit-file mode and rejects missing context', async (t) => {
  const { workspace } = await fixture(t);
  let prompt;
  await ask({ workspace, files: ['example.js'], question: 'What is add?',
    client: { async complete(value) { prompt = value.user; return 'ok'; } } });
  assert.match(prompt, /SOURCE: example.js/);
  await assert.rejects(ask({ workspace, files: [], contextSources: [], question: 'Nothing', client: {} }), /requires/i);
});

function fullFileHit(relativePath, content, score) {
  return {
    score,
    payload: {
      repository_id: repositoryId,
      embedding_model: model,
      relative_path: relativePath,
      start_line: 1,
      end_line: content.split('\n').length,
      source_hash: sha256(content),
      chunk_hash: sha256(content),
      content,
    },
  };
}

test('implementation questions include relevant code even if documentation has higher vector similarity', async (t) => {
  const { workspace, dir } = await fixture(t);
  await mkdir(join(dir, 'docs'), { recursive: true });
  await mkdir(join(dir, 'agent-core', 'src'), { recursive: true });
  const docs = [];
  for (let i = 0; i < 5; i++) {
    const path = `docs/edit-guide-${i}.md`;
    const content = `# EDIT approval mechanism ${i}\nThis document describes approval, implementation and editing.\n`;
    await writeFile(join(dir, path), content);
    docs.push(fullFileHit(path, content, 0.99 - (i * 0.01)));
  }
  const cliCode = 'const approval = await rl.question(`Type APPLY ${id} to confirm: `);\n';
  const proposalCode = 'export function applyProposal(workspace, id, approval) {\n  if (approval !== `APPLY ${id}`) throw new Error("approval required");\n}\n';
  await writeFile(join(dir, 'agent-core', 'cli.mjs'), cliCode);
  await writeFile(join(dir, 'agent-core', 'src', 'proposals.mjs'), proposalCode);
  const candidates = [
    ...docs,
    fullFileHit('agent-core/cli.mjs', cliCode, 0.51),
    fullFileHit('agent-core/src/proposals.mjs', proposalCode, 0.50),
  ];
  const question = 'Where is the EDIT approval mechanism implemented? Cite relevant files and line ranges.';
  const sources = await createContextProvider({
    workspace,
    repositoryId,
    embedder: { model, async embed(values) { assert.deepEqual(values, [question]); return [[1, 2, 3]]; } },
    qdrant: { async queryPoints(opts) {
      assert.equal(opts.limit, 48);
      assert.equal(opts.repositoryId, repositoryId);
      assert.equal(opts.embeddingModel, model);
      return candidates;
    } },
    limit: 6,
  }).retrieve(question);
  assert.equal(sources.length, 6);
  assert.ok(sources.some((s) => s.relativePath === 'agent-core/cli.mjs'));
  assert.ok(sources.some((s) => s.relativePath === 'agent-core/src/proposals.mjs'));
  assert.equal(sources[0].relativePath.endsWith('.md'), false, 'implementation code should be represented early');
  assert.ok(sources.every((s) => Number.isSafeInteger(s.startLine) && Number.isSafeInteger(s.endLine)));
});

test('conceptual questions retain semantic ordering instead of forcing code into context', async (t) => {
  const { workspace, dir } = await fixture(t);
  await mkdir(join(dir, 'docs'), { recursive: true });
  const md = '# READ ME\nThe conceptual overview of ingestion and retrieval.\n';
  const code = 'export function unrelatedFunction() { return 1; }\n';
  await writeFile(join(dir, 'docs', 'overview.md'), md);
  await writeFile(join(dir, 'example.js'), code);
  const question = 'Summarize the conceptual overview of ingestion and retrieval';
  const sources = await createContextProvider({
    workspace, repositoryId,
    embedder: { model, async embed() { return [[1, 2, 3]]; } },
    qdrant: { async queryPoints() {
      return [fullFileHit('docs/overview.md', md, 0.95), fullFileHit('example.js', code, 0.35)];
    } },
    limit: 1,
  }).retrieve(question);
  assert.equal(sources[0].relativePath, 'docs/overview.md');
});

test('context budget is enforced after re-ranking and duplicate source ranges are excluded', async (t) => {
  const { workspace, dir } = await fixture(t);
  await mkdir(join(dir, 'docs'), { recursive: true });
  const doc = `# Approval\n${'approval '.repeat(80)}\n`;
  const src = 'const approval = `APPLY ${id}`;\n';
  await writeFile(join(dir, 'docs', 'approval.md'), doc);
  await writeFile(join(dir, 'example.js'), src);
  const question = 'Where is the approval mechanism implemented?';
  const sources = await createContextProvider({
    workspace, repositoryId,
    embedder: { model, async embed() { return [[1, 2, 3]]; } },
    qdrant: { async queryPoints() {
      return [
        fullFileHit('docs/approval.md', doc, 0.98),
        fullFileHit('docs/approval.md', doc, 0.98),
        fullFileHit('example.js', src, 0.5),
      ];
    } },
    limit: 3, maxContextBytes: 512,
  }).retrieve(question);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].relativePath, 'example.js');
});

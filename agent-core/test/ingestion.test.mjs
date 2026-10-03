import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { discoverFiles } from '../src/ingestion/files.mjs';
import { splitChunks } from '../src/ingestion/chunks.mjs';
import { indexWorkspace, pointId } from '../src/ingestion/indexer.mjs';
import { createEmbedder, createQdrant } from '../src/ingestion/clients.mjs';

const fixture = async (fn) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ingest-node-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};
const repo = 'fixture-repository';
const embedder = {
  model: 'nomic-embed-text:latest', calls: 0,
  async embed(texts) { this.calls++; return texts.map(() => [0.25, 0.5, 0.75]); },
};
function fakeQdrant() {
  return {
    rows: new Map(), ensured: [],
    async existing(id) { return [...this.rows.values()].filter((p) => p.payload.repository_id === id); },
    async ensure(dimension) { this.ensured.push(dimension); },
    async upsert(points) { for (const point of points) this.rows.set(point.id, point); },
    async deleteIds(ids) { for (const id of ids) this.rows.delete(id); },
  };
}

test('discover uses explicit extensions; excludes secrets, ignored folders and symlinks', async () => fixture(async (dir) => {
  await mkdir(path.join(dir, 'node_modules'));
  await writeFile(path.join(dir, 'node_modules', 'leak.rs'), 'avoid');
  await writeFile(path.join(dir, '.env'), 'password=secret');
  await writeFile(path.join(dir, 'good.rs'), 'fn main() {}\n');
  await writeFile(path.join(dir, 'ignore.ts'), 'const a = 1');
  await writeFile(path.join(dir, 'binary.c'), Buffer.from([0, 1, 2]));
  await symlink('/etc/hosts', path.join(dir, 'outside.h'));
  const files = await discoverFiles(dir);
  assert.deepEqual(files.map((file) => file.relativePath), ['good.rs']);
}));

test('chunk boundaries and stable IDs preserve reproducible provenance', () => {
  const chunks = splitChunks('aa\nbb\ncc\ndd\n', { size: 7, overlap: 2 });
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].startLine, 1);
  assert.ok(chunks.every((c) => c.endLine >= c.startLine && c.content.length <= 7));
  const one = pointId({ repositoryId: repo, path: 'one.rs', model: embedder.model, chunk: chunks[0] });
  const two = pointId({ repositoryId: repo, path: 'one.rs', model: embedder.model, chunk: chunks[0] });
  assert.equal(one, two);
  assert.match(one, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
});

test('dry run requires no network and does not mutate Qdrant', async () => fixture(async (dir) => {
  await writeFile(path.join(dir, 'main.rs'), 'fn main() {}\n');
  const result = await indexWorkspace({ workspace: dir, repositoryId: repo, dryRun: true });
  assert.equal(result.files, 1);
  assert.equal(result.chunks, 1);
}));

test('second run is idempotent and skips embeddings for unchanged files', async () => fixture(async (dir) => {
  await writeFile(path.join(dir, 'main.rs'), 'fn main() {}\n');
  const q = fakeQdrant();
  const embed = { ...embedder, calls: 0 };
  const first = await indexWorkspace({ workspace: dir, repositoryId: repo, embedder: embed, qdrant: q });
  const previous = [...q.rows.keys()];
  const second = await indexWorkspace({ workspace: dir, repositoryId: repo, embedder: embed, qdrant: q });
  assert.equal(first.updated, 1);
  assert.equal(second.unchanged, 1);
  assert.equal(embed.calls, 1);
  assert.deepEqual([...q.rows.keys()], previous);
  assert.deepEqual(q.ensured, [3]);
}));

test('changed file is replaced without retaining stale point IDs', async () => fixture(async (dir) => {
  const filepath = path.join(dir, 'main.rs');
  await writeFile(filepath, 'fn main() {}\n');
  const q = fakeQdrant();
  const embed = { ...embedder, calls: 0 };
  await indexWorkspace({ workspace: dir, repositoryId: repo, embedder: embed, qdrant: q });
  const old = [...q.rows.keys()];
  await writeFile(filepath, 'fn main() { println!("changed"); }\n');
  await indexWorkspace({ workspace: dir, repositoryId: repo, embedder: embed, qdrant: q });
  assert.equal(q.rows.size, 1);
  assert.notEqual([...q.rows.keys()][0], old[0]);
}));

test('deleted files are pruned only with explicit flag, scoped to repository ID', async () => fixture(async (dir) => {
  await writeFile(path.join(dir, 'a.rs'), 'fn a() {}\n');
  await writeFile(path.join(dir, 'b.c'), 'int b() {return 2;}\n');
  const q = fakeQdrant();
  const embed = { ...embedder, calls: 0 };
  await indexWorkspace({ workspace: dir, repositoryId: repo, embedder: embed, qdrant: q });
  q.rows.set('other-repo', { id: 'other-repo', payload: { repository_id: 'other', relative_path: 'x.rs' } });
  await rm(path.join(dir, 'b.c'));
  await indexWorkspace({ workspace: dir, repositoryId: repo, embedder: embed, qdrant: q });
  assert.equal(q.rows.size, 3);
  const result = await indexWorkspace({ workspace: dir, repositoryId: repo, embedder: embed, qdrant: q, prune: true });
  assert.equal(result.deleted, 1);
  assert.equal(q.rows.size, 2);
  assert.ok(q.rows.has('other-repo'));
}));

test('failed embeddings preserve previous index and never run deletion/pruning', async () => fixture(async (dir) => {
  const file = path.join(dir, 'main.rs');
  await writeFile(file, 'fn first() {}\n');
  const q = fakeQdrant();
  await indexWorkspace({ workspace: dir, repositoryId: repo, embedder: { ...embedder }, qdrant: q });
  const old = [...q.rows.keys()];
  await writeFile(file, 'fn changed() {}\n');
  await assert.rejects(indexWorkspace({ workspace: dir, repositoryId: repo, qdrant: q,
    embedder: { model: embedder.model, async embed() { throw new Error('unavailable'); } },
    prune: true,
  }), /unavailable/);
  assert.deepEqual([...q.rows.keys()], old);
}));

test('different embedding models are rejected for an existing repository', async () => fixture(async (dir) => {
  await writeFile(path.join(dir, 'main.rs'), 'fn first() {}\n');
  const q = fakeQdrant();
  await indexWorkspace({ workspace: dir, repositoryId: repo, embedder: { ...embedder }, qdrant: q });
  await assert.rejects(indexWorkspace({ workspace: dir, repositoryId: repo, embedder: {
    model: 'other-embedding-model', async embed() { return [[0.5]]; },
  }, qdrant: q }), /different embedding model/);
}));

test('Ollama embeds in batches using /api/embed', async () => {
  const calls = [];
  const impl = async (url, request) => {
    calls.push({ url, body: JSON.parse(request.body) });
    return { ok: true, json: async () => ({ embeddings: JSON.parse(request.body).input.map(() => [1, 2]) }) };
  };
  const embed = createEmbedder({ fetchImpl: impl, batchSize: 2 });
  const vectors = await embed.embed(['A', 'B', 'C']);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((entry) => entry.url.endsWith('/api/embed')));
  assert.equal(vectors.length, 3);
});

test('Qdrant scroll enforces repository filter and paginates', async () => {
  const seen = [];
  const impl = async (url, request) => {
    if (request.method === 'GET') return { ok: true, json: async () => ({ result: { config: { params: { vectors: { size: 3, distance: 'Cosine' } } } } }) };
    const body = JSON.parse(request.body);
    seen.push(body);
    if (seen.length === 1) return { ok: true, json: async () => ({ result: { points: [{ id: '1' }], next_page_offset: '1' } }) };
    return { ok: true, json: async () => ({ result: { points: [{ id: '2' }], next_page_offset: null } }) };
  };
  const q = createQdrant({ fetchImpl: impl });
  const points = await q.existing(repo);
  assert.deepEqual(points.map(({ id }) => id), ['1', '2']);
  assert.deepEqual(seen[0].filter.must[0].match.value, repo);
  assert.equal(seen[1].offset, '1');
});

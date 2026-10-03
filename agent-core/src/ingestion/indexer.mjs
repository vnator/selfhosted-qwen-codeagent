import { createHash } from 'node:crypto';
import { discoverFiles, sha256 } from './files.mjs';
import { splitChunks, languageFor, CHUNKER_VERSION } from './chunks.mjs';

// Qdrant accepts UUIDs. Create stable, UUID-shaped identifiers from the index identity.
export function pointId({ repositoryId, path, model, chunk }) {
  const digest = createHash('sha256').update(JSON.stringify([
    repositoryId, path, CHUNKER_VERSION, model,
    chunk.index, chunk.startLine, chunk.endLine, chunk.chunkHash,
  ])).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Reconcile one explicit workspace into a repository-scoped Qdrant collection.
 * Upsert new points first, then delete stale IDs. Pruning deleted files is opt-in.
 * All external I/O is injected to keep this library testable and editor-independent.
 */
export async function indexWorkspace({
  workspace,
  repositoryId,
  extensions,
  dryRun = false,
  prune = false,
  embedder,
  qdrant,
  discover = discoverFiles,
  logger = () => {},
} = {}) {
  if (!workspace || typeof workspace !== 'string') throw new Error('An explicit workspace path is required');
  if (typeof repositoryId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(repositoryId)) {
    throw new Error('Provide a stable --repository ID (2–128 letters/digits/._-)');
  }
  const files = await discover(workspace, { ...(extensions ? { extensions } : {}) });
  if (prune && !files.length) throw new Error('Refusing to prune an empty workspace');
  const summary = { repositoryId, files: files.length, chunks: 0, unchanged: 0, updated: 0, deleted: 0, dryRun };
  const plans = files.map((file) => {
    const chunks = splitChunks(file.content);
    summary.chunks += chunks.length;
    const points = chunks.map((chunk) => ({
      id: pointId({ repositoryId, path: file.relativePath, model: embedder?.model || '', chunk }),
      payload: {
        repository_id: repositoryId,
        relative_path: file.relativePath,
        language: languageFor(file.relativePath),
        start_line: chunk.startLine,
        end_line: chunk.endLine,
        source_hash: file.sourceHash || sha256(file.content),
        chunk_hash: chunk.chunkHash,
        chunker_version: CHUNKER_VERSION,
        embedding_model: embedder?.model,
        ingested_at: new Date().toISOString(),
        content: chunk.content,
      },
    }));
    return { file, chunks, points };
  });
  if (dryRun) {
    for (const plan of plans) logger(`[dry-run] ${plan.file.relativePath}: ${plan.points.length} chunks`);
    return summary;
  }
  if (!embedder?.embed || !embedder?.model || !qdrant?.existing || !qdrant?.upsert || !qdrant?.deleteIds || !qdrant?.ensure) {
    throw new Error('Embedding and Qdrant clients are required for live indexing');
  }
  const oldPoints = await qdrant.existing(repositoryId);
  // Never mix embeddings from different models even if their dimensions happen to match.
  for (const point of oldPoints) {
    if (point.payload?.embedding_model !== embedder.model) {
      throw new Error('Existing repository uses a different embedding model; use a new collection or reindex deliberately');
    }
  }
  const oldByPath = new Map();
  for (const point of oldPoints) {
    const filePath = point.payload?.relative_path;
    if (typeof filePath !== 'string') throw new Error('Existing index has missing relative_path metadata');
    if (!oldByPath.has(filePath)) oldByPath.set(filePath, []);
    oldByPath.get(filePath).push(point);
  }
  let collectionReady = false;
  for (const plan of plans) {
    const prior = oldByPath.get(plan.file.relativePath) || [];
    const ids = new Set(plan.points.map((point) => point.id));
    if (prior.length === ids.size && prior.every((point) => ids.has(point.id))) {
      summary.unchanged++;
      logger(`SKIP ${plan.file.relativePath}: unchanged`);
      continue;
    }
    if (plan.points.length) {
      const vectors = await embedder.embed(plan.chunks.map((chunk) => chunk.content));
      if (vectors.length !== plan.points.length || !vectors.length) throw new Error('Embedding batch count mismatch');
      if (!collectionReady) {
        await qdrant.ensure(vectors[0].length);
        collectionReady = true;
      }
      const points = plan.points.map((point, i) => ({ ...point, vector: vectors[i] }));
      // One awaited upsert before deleting old points prevents deleting good data on embedding failure.
      await qdrant.upsert(points);
    }
    const stale = prior.filter((point) => !ids.has(point.id)).map((point) => point.id);
    if (stale.length) await qdrant.deleteIds(stale);
    summary.updated++;
    logger(`INDEX ${plan.file.relativePath}: ${plan.points.length} chunks; ${stale.length} stale removed`);
  }
  if (prune) {
    const currentPaths = new Set(plans.map(({ file }) => file.relativePath));
    for (const [oldPath, stale] of oldByPath) {
      if (currentPaths.has(oldPath)) continue;
      await qdrant.deleteIds(stale.map((point) => point.id));
      summary.deleted++;
      logger(`DELETE ${oldPath}: ${stale.length} stale points`);
    }
  }
  return summary;
}

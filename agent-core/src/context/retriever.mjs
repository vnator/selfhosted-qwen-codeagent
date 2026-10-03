import { readWorkspaceFile, MAX_READ_BYTES } from '../workspace.mjs';
import { sha256 } from '../ingestion/files.mjs';
import { selectContextSources } from './ranker.mjs';

const REPOSITORY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;
const MAX_QUERY_BYTES = 4096;

/**
 * Read-only context retrieval. Qdrant is an untrusted index, not a file authority:
 * every hit is checked against the current workspace before reaching the LLM.
 * No tools, shell commands, writes or automatic reindexing take place here.
 */
export function createContextProvider({
  workspace,
  repositoryId,
  embedder,
  qdrant,
  limit = 6,
  maxContextBytes = 12 * 1024,
} = {}) {
  if (!workspace?.root) throw new Error('An open workspace is required');
  if (typeof repositoryId !== 'string' || !REPOSITORY_ID.test(repositoryId)) {
    throw new Error('A stable --repository ID is required (2–128 letters/digits/._-)');
  }
  if (!embedder?.model || typeof embedder.embed !== 'function' || typeof qdrant?.queryPoints !== 'function') {
    throw new Error('Compatible embedding and Qdrant clients are required');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new Error('Context limit must be 1–12');
  if (!Number.isInteger(maxContextBytes) || maxContextBytes < 512 || maxContextBytes > 24 * 1024) {
    throw new Error('Context budget must be between 512 and 24576 bytes');
  }
  return {
    repositoryId,
    async retrieve(question) {
      if (typeof question !== 'string' || !question.trim() || Buffer.byteLength(question, 'utf8') > MAX_QUERY_BYTES) {
        throw new Error('A nonempty retrieval question (at most 4096 bytes) is required');
      }
      const vectors = await embedder.embed([question]);
      const vector = vectors?.[0];
      if (!Array.isArray(vectors) || vectors.length !== 1 || !Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite)) {
        throw new Error('Invalid query embedding');
      }
      // Fetch more candidates than we display: stale and inaccessible entries must be skipped.
      const points = await qdrant.queryPoints({
        vector,
        repositoryId,
        embeddingModel: embedder.model,
        limit: 48,
      });
      if (!Array.isArray(points)) throw new Error('Qdrant returned an invalid list of points');
      const verified = [];
      const checked = new Map();
      const seen = new Set();
      for (const point of points) {
        const p = point?.payload;
        // Double-check server-side filters; never trust Qdrant content as workspace authority.
        if (!p || p.repository_id !== repositoryId || p.embedding_model !== embedder.model) continue;
        if (typeof p.relative_path !== 'string' || !p.relative_path ||
            typeof p.source_hash !== 'string' || typeof p.chunk_hash !== 'string' ||
            typeof p.content !== 'string' || !p.content ||
            !Number.isSafeInteger(p.start_line) || !Number.isSafeInteger(p.end_line) ||
            p.start_line < 1 || p.end_line < p.start_line ||
            !Number.isFinite(point.score) || sha256(p.content) !== p.chunk_hash) continue;
        const key = `${p.relative_path}:${p.start_line}:${p.end_line}:${p.chunk_hash}`;
        if (seen.has(key)) continue;
        let current;
        if (checked.has(p.relative_path)) current = checked.get(p.relative_path);
        else {
          try { current = await readWorkspaceFile(workspace, p.relative_path, MAX_READ_BYTES); }
          catch { current = null; }
          checked.set(p.relative_path, current);
        }
        // Do not supply outdated / forged chunks, secrets or escaped paths to the model.
        if (!current || current.hash !== p.source_hash || !current.content.includes(p.content)) continue;
        if (p.end_line > current.content.split('\n').length) continue;
        const entry = {
          relativePath: current.relativePath,
          startLine: p.start_line,
          endLine: p.end_line,
          content: p.content,
          score: point.score,
        };
        verified.push(entry);
        seen.add(key);
      }
      return selectContextSources(verified, question, { limit, maxContextBytes });
    },
  };
}

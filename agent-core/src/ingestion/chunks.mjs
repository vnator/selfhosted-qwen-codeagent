import { sha256 } from './files.mjs';

export const CHUNKER_VERSION = 'line-aware-v1';
export function languageFor(relativePath) {
  const ext = relativePath.slice(relativePath.lastIndexOf('.') + 1).toLowerCase();
  return ext === 'rs' ? 'rust' : ['c', 'h'].includes(ext) ? 'c' : ext;
}

/** Deterministic character window with a preference for newline boundaries.
 * It is intentionally NOT byte-for-byte equivalent to LangChain's Python splitter.
 */
export function splitChunks(content, { size = 800, overlap = 100 } = {}) {
  if (!Number.isSafeInteger(size) || !Number.isSafeInteger(overlap) || size < 1 || overlap < 0 || overlap >= size) {
    throw new Error('Expected integer chunk size > overlap >= 0');
  }
  if (!content.length) return [];
  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === '\n') lineStarts.push(i + 1);
  const lineAt = (pos) => {
    let lo = 0; let hi = lineStarts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= pos) lo = mid + 1;
      else hi = mid;
    }
    return lo; // 1-based line number
  };
  const chunks = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + size, content.length);
    if (end < content.length) {
      // Prefer the last newline in the latter half, without producing tiny chunks.
      const preferred = content.lastIndexOf('\n', end - 1);
      if (preferred >= start + Math.floor(size / 2)) end = preferred + 1;
    }
    const text = content.slice(start, end);
    chunks.push({
      index: chunks.length,
      startLine: lineAt(start),
      endLine: lineAt(Math.max(start, end - 1)),
      content: text,
      chunkHash: sha256(text),
    });
    if (end === content.length) break;
    const next = Math.max(start + 1, end - overlap);
    start = next;
  }
  return chunks;
}

import { createHash } from 'node:crypto';
import { realpath, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// Preserve the original Python allowlist for the initial, testable migration.
export const DEFAULT_EXTENSIONS = Object.freeze(['.rs', '.c', '.h']);
const IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'target', 'dist', 'build', '.next',
  '.cache', 'coverage', '.venv', 'venv', '__pycache__', '.qdrant',
]);
const PRIVATE_NAME = /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|id_(?:rsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx))$/i;
const MAX_FILES = 20000;
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export function safeFileName(name) {
  return !name.startsWith('.') && !PRIVATE_NAME.test(name);
}

export async function discoverFiles(root, {
  extensions = DEFAULT_EXTENSIONS,
  maxBytes = 1024 * 1024,
} = {}) {
  const rootReal = await realpath(root);
  if (!(await stat(rootReal)).isDirectory()) throw new Error('Ingestion workspace must be a directory');
  const permitted = new Set(extensions.map((ext) => ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`));
  const found = [];
  let totalBytes = 0;
  const walk = async (directory, relativeDir = '') => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      // Skip all symbolic links, including those pointing inside the workspace.
      if (entry.isSymbolicLink()) continue;
      const rel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && safeFileName(entry.name)) await walk(full, rel);
      } else if (entry.isFile() && safeFileName(entry.name) && permitted.has(path.extname(entry.name).toLowerCase())) {
        const metadata = await stat(full);
        if (metadata.size > maxBytes) continue;
        const buffer = await readFile(full);
        if (buffer.includes(0)) continue;
        // Decode invalid UTF-8 strictly rather than silently changing source text.
        let content;
        try { content = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
        catch { continue; }
        totalBytes += buffer.length;
        if (totalBytes > 128 * 1024 * 1024) throw new Error('Corpus exceeds 128 MiB; narrow the workspace or split ingestion jobs');
        found.push({ relativePath: rel, content, sourceHash: sha256(buffer), bytes: buffer.length });
        if (found.length > MAX_FILES) throw new Error(`More than ${MAX_FILES} files: narrow the ingestion scope`);
      }
    }
  };
  await walk(rootReal);
  return found;
}

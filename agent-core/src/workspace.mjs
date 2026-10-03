import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

const BLOCKED_SEGMENTS = new Set([
  '.git', 'node_modules', 'vendor', 'dist', 'build', 'target', 'coverage',
  '.next', '.venv', '__pycache__', '.terraform', '.agent-proposals',
]);
const BLOCKED_NAMES = /^(?:\.env(?:\..*)?|id_(?:rsa|ed25519|ecdsa)|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore))$/i;
const TEXT_EXTENSIONS = new Set([
  '.rs', '.c', '.h', '.cc', '.cpp', '.hpp', '.go', '.java', '.py', '.rb',
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.lua', '.astro',
  '.css', '.scss', '.html', '.md', '.mdx', '.txt', '.sh', '.bash',
  '.json', '.jsonc', '.toml', '.yaml', '.yml', '.xml', '.sql',
  '.diff', '.patch', '.graphql', '.proto',
]);
const TEXT_BASENAMES = new Set(['Dockerfile', 'Makefile', '.gitignore', '.dockerignore']);
export const MAX_READ_BYTES = 64 * 1024;
export const MAX_EDIT_BYTES = 12 * 1024;

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

function isInside(root, candidate) {
  return candidate !== root && candidate.startsWith(root + sep);
}

export async function openWorkspace(rootPath) {
  const root = await realpath(rootPath);
  const stat = await lstat(root);
  if (!stat.isDirectory()) throw new Error('Workspace must be a directory');
  return Object.freeze({ root });
}

export async function resolveWorkspaceFile(workspace, requestedPath, limit = MAX_READ_BYTES) {
  if (typeof requestedPath !== 'string' || !requestedPath || isAbsolute(requestedPath) || requestedPath.includes('\\')) {
    throw new Error('File path must be relative to the workspace');
  }
  const target = resolve(workspace.root, requestedPath);
  if (!isInside(workspace.root, target)) throw new Error('Path escapes the workspace');
  const rel = relative(workspace.root, target);
  const parts = rel.split(sep);
  if (parts.some((part) => BLOCKED_SEGMENTS.has(part) || BLOCKED_NAMES.test(part))) {
    throw new Error('Protected file or directory');
  }
  const name = basename(target);
  if (!TEXT_EXTENSIONS.has(extname(name).toLowerCase()) && !TEXT_BASENAMES.has(name)) {
    throw new Error('File type is not in the allowed text list');
  }

  // Reject any existing symlink in the path, including intermediate directories.
  let current = workspace.root;
  for (let i = 0; i < parts.length; i++) {
    current = resolve(current, parts[i]);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error('Symlink access is not allowed');
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error('Invalid parent directory');
    if (i === parts.length - 1 && (!stat.isFile() || stat.size > limit)) {
      throw new Error('File must be a regular text file within the size limit');
    }
  }
  const canonical = await realpath(target);
  if (canonical !== target) throw new Error('Non-canonical path rejected');
  return { path: canonical, relativePath: rel.replaceAll(sep, '/') };
}

export async function readWorkspaceFile(workspace, requestedPath, limit = MAX_READ_BYTES) {
  const ref = await resolveWorkspaceFile(workspace, requestedPath, limit);
  const raw = await readFile(ref.path);
  if (raw.length > limit || raw.includes(0)) throw new Error('Binary or oversized file rejected');
  const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  return { ...ref, content, hash: sha256(content), bytes: raw.length };
}

export function numberedText(content) {
  return content.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');
}

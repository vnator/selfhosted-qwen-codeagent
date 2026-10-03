import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import {
  chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile,
} from 'node:fs/promises';
import { readWorkspaceFile, sha256 } from './workspace.mjs';
import { preserveFileLayout } from './text-layout.mjs';

const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{64}$/i;

export async function getStateDirectory(workspace) {
  const id = sha256(workspace.root).slice(0, 20);
  const defaultStateRoot = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  const base = resolve(process.env.AGENT_STATE_DIR || join(defaultStateRoot, 'selfhosted-qwen-codeagent'));
  await mkdir(base, { recursive: true, mode: 0o700 });
  const canonicalBase = await realpath(base);
  if (canonicalBase === workspace.root || canonicalBase.startsWith(workspace.root + sep)) {
    throw new Error('Agent state must be outside the source workspace');
  }
  const directory = join(canonicalBase, id, 'proposals');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  return directory;
}

export async function renderPreview(workspace, original, replacement, relativePath) {
  const stateDir = await getStateDirectory(workspace);
  const tempDir = await mkdtemp(join(stateDir, 'preview-'));
  await chmod(tempDir, 0o700);
  try {
    const a = join(tempDir, 'old');
    const b = join(tempDir, 'new');
    await writeFile(a, original, { mode: 0o600 });
    await writeFile(b, replacement, { mode: 0o600 });
    const result = spawnSync('diff', [
      '-u', '--label', `a/${relativePath}`, '--label', `b/${relativePath}`, a, b,
    ], { encoding: 'utf8', timeout: 3_000, maxBuffer: 1_000_000 });
    if (result.error || ![0, 1].includes(result.status)) {
      throw new Error(`Unable to preview diff: ${result.error?.message || result.stderr || result.status}`);
    }
    return result.stdout || '(No visible difference)';
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function stageProposal({ workspace, source, replacement }) {
  // Enforce the source layout even for callers bypassing prepareEdit().
  replacement = preserveFileLayout(source.content, replacement);
  if (replacement === source.content) throw new Error('No changes were proposed');
  const id = randomUUID();
  const proposal = {
    schemaVersion: 1,
    id,
    workspaceId: sha256(workspace.root),
    relativePath: source.relativePath,
    originalHash: source.hash,
    proposedHash: sha256(replacement),
    replacement,
    createdAt: new Date().toISOString(),
  };
  const diff = await renderPreview(workspace, source.content, replacement, source.relativePath);
  const stateDir = await getStateDirectory(workspace);
  await writeFile(join(stateDir, `${id}.json`), JSON.stringify(proposal, null, 2), {
    mode: 0o600,
    flag: 'wx',
  });
  return { id, diff, relativePath: source.relativePath };
}

async function loadProposal(workspace, id) {
  if (!UUID_RE.test(id)) throw new Error('Invalid proposal ID');
  const stateDir = await getStateDirectory(workspace);
  const file = join(stateDir, `${id}.json`);
  const fileStat = await lstat(file);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error('Invalid proposal file');
  const proposal = JSON.parse(await readFile(file, 'utf8'));
  if (
    proposal.schemaVersion !== 1 || proposal.id !== id ||
    proposal.workspaceId !== sha256(workspace.root) ||
    !SHA_RE.test(proposal.originalHash) ||
    !SHA_RE.test(proposal.proposedHash) ||
    typeof proposal.relativePath !== 'string' ||
    typeof proposal.replacement !== 'string' ||
    sha256(proposal.replacement) !== proposal.proposedHash
  ) {
    throw new Error('Invalid, corrupted or foreign proposal');
  }
  return { proposal, stateFile: file };
}

export async function previewProposal(workspace, id) {
  const { proposal } = await loadProposal(workspace, id);
  const source = await readWorkspaceFile(workspace, proposal.relativePath);
  if (source.hash !== proposal.originalHash) throw new Error('STALE proposal: source file changed since the proposal was created');
  const diff = await renderPreview(workspace, source.content, proposal.replacement, source.relativePath);
  return { proposal, source, diff };
}

export async function applyProposal(workspace, id, approval) {
  if (approval !== `APPLY ${id}`) throw new Error('Explicit proposal-specific approval is required');
  const { proposal, source } = await previewProposal(workspace, id);
  const mode = (await stat(source.path)).mode & 0o777;
  const tempFile = join(dirname(source.path), `.${basename(source.path)}.agent-${id}.tmp`);
  try {
    await writeFile(tempFile, proposal.replacement, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(tempFile, mode);
    // Verify both path and content again, immediately before atomic replace.
    const current = await readWorkspaceFile(workspace, proposal.relativePath);
    if (current.path !== source.path || current.hash !== proposal.originalHash) {
      throw new Error('STALE proposal: source changed during apply');
    }
    await rename(tempFile, source.path);
  } finally {
    await rm(tempFile, { force: true });
  }
  return { relativePath: proposal.relativePath, hash: proposal.proposedHash };
}

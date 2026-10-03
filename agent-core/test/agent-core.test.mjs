import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { openWorkspace, readWorkspaceFile } from '../src/workspace.mjs';
import { ask, extractReplacement, prepareEdit, review } from '../src/runtime.mjs';
import { applyProposal, previewProposal, stageProposal } from '../src/proposals.mjs';
import { createOllamaClient } from '../src/ollama.mjs';

// One isolated state root per test; never touch a developer's real state directory.
async function fixture(t) {
  const tmp = await mkdtemp(join(tmpdir(), 'agent-core-test-'));
  const root = join(tmp, 'repo');
  const state = join(tmp, 'state');
  await mkdir(root);
  await mkdir(state);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'sum.ts'), 'export const sum = (a: number, b: number) => a + b;\n');
  await writeFile(join(root, '.env'), 'SECRET=not-for-the-model\n');
  await writeFile(join(root, 'changes.patch'), '--- a/src/sum.ts\n+++ b/src/sum.ts\n');
  const prev = process.env.AGENT_STATE_DIR;
  process.env.AGENT_STATE_DIR = state;
  t.after(async () => {
    if (prev === undefined) delete process.env.AGENT_STATE_DIR;
    else process.env.AGENT_STATE_DIR = prev;
    await rm(tmp, { recursive: true, force: true });
  });
  return { root, workspace: await openWorkspace(root) };
}

test('ASK includes only explicitly supplied files with line references', async (t) => {
  const { workspace } = await fixture(t);
  let request;
  const answer = await ask({
    workspace, files: ['src/sum.ts'], question: 'What does this function do?',
    client: { complete: async (input) => { request = input; return 'It sums two values.'; } },
  });
  assert.equal(answer, 'It sums two values.');
  assert.match(request.user, /SOURCE: src\/sum\.ts\n1: export const sum/);
  assert.doesNotMatch(request.user, /SECRET=/);
  assert.match(request.system, /untrusted data/);
});

test('workspace denies secrets, traversal, binary files and symlink escapes', async (t) => {
  const { root, workspace } = await fixture(t);
  await assert.rejects(readWorkspaceFile(workspace, '.env'), /Protected/);
  await assert.rejects(readWorkspaceFile(workspace, '../outside.ts'), /escapes/);
  await writeFile(join(root, 'src', 'binary.ts'), Buffer.from([0, 1, 2]));
  await assert.rejects(readWorkspaceFile(workspace, 'src/binary.ts'), /Binary/);
  await symlink(join(root, 'src', 'sum.ts'), join(root, 'src', 'linked.ts'));
  await assert.rejects(readWorkspaceFile(workspace, 'src/linked.ts'), /Symlink/);
});

test('EDIT rejects textual tool JSON, Markdown and missing markers', () => {
  assert.throws(() => extractReplacement('{"name":"read_file"}'), /format/);
  assert.throws(() => extractReplacement('```ts\nconst a = 1;\n```'), /format/);
  assert.throws(() => extractReplacement('I would update the function'), /format/);
  assert.equal(extractReplacement('<<<BEGIN_REPLACEMENT>>>\nnew text\n<<<END_REPLACEMENT>>>'), 'new text');
});

test('EDIT stages a reviewable diff; only exact approval applies the change', async (t) => {
  const { root, workspace } = await fixture(t);
  const original = await readFile(join(root, 'src', 'sum.ts'), 'utf8');
  const newCode = 'export function sum(a: number, b: number): number { return a + b; }\n';
  const result = await prepareEdit({
    workspace, file: 'src/sum.ts', instruction: 'Use a regular function',
    client: { complete: async () => `<<<BEGIN_REPLACEMENT>>>\n${newCode}\n<<<END_REPLACEMENT>>>` },
    stage: stageProposal,
  });
  assert.match(result.diff, /^--- a\/src\/sum.ts/m);
  assert.match(result.diff, /\+export function sum/);
  assert.equal(await readFile(join(root, 'src', 'sum.ts'), 'utf8'), original, 'proposal must not modify source');
  await assert.rejects(applyProposal(workspace, result.id, 'yes'), /approval/);
  const preview = await previewProposal(workspace, result.id);
  assert.equal(preview.proposal.relativePath, 'src/sum.ts');
  const applied = await applyProposal(workspace, result.id, `APPLY ${result.id}`);
  assert.equal(applied.relativePath, 'src/sum.ts');
  assert.equal(await readFile(join(root, 'src', 'sum.ts'), 'utf8'), newCode);
});

test('EDIT refuses stale proposals instead of overwriting new user work', async (t) => {
  const { root, workspace } = await fixture(t);
  const result = await prepareEdit({
    workspace, file: 'src/sum.ts', instruction: 'Refactor',
    client: { complete: async () => '<<<BEGIN_REPLACEMENT>>>\nexport const sum = () => 42;\n<<<END_REPLACEMENT>>>' },
    stage: stageProposal,
  });
  await writeFile(join(root, 'src', 'sum.ts'), '// independent developer change\n');
  await assert.rejects(applyProposal(workspace, result.id, `APPLY ${result.id}`), /STALE/);
  assert.equal(await readFile(join(root, 'src', 'sum.ts'), 'utf8'), '// independent developer change\n');
});

test('REVIEW never edits and cites only the chosen diff', async (t) => {
  const { workspace } = await fixture(t);
  let captured;
  await review({
    workspace, diffPath: 'changes.patch', question: 'Check regressions',
    client: { complete: async (input) => { captured = input; return 'No findings.'; } },
  });
  assert.match(captured.user, /DIFF SOURCE: changes\.patch/);
  assert.match(captured.system, /No edits or tools/);
});

test('Ollama client does not declare tools or execute textual JSON/XML', async () => {
  let request;
  const client = createOllamaClient({
    url: 'http://127.0.0.1:11434',
    model: 'qwen2.5-coder:7b',
    transport: async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, json: async () => ({ message: { content: '{"name":"read_file","arguments":{}}' }, done_reason: 'stop' }) };
    },
  });
  const output = await client.complete({ system: 'system', user: 'user' });
  assert.equal(output, '{"name":"read_file","arguments":{}}');
  assert.equal(Object.hasOwn(request, 'tools'), false);
  assert.equal(request.options.num_ctx, 16384);
  assert.throws(() => createOllamaClient({ url: 'http://example.com:11434' }), /loopback/);
});

test('EDIT preserves original LF terminator when the model omits it', async (t) => {
  const { root, workspace } = await fixture(t);
  const result = await prepareEdit({
    workspace, file: 'src/sum.ts', instruction: 'Add explicit return type',
    client: { complete: async () => '<<<BEGIN_REPLACEMENT>>>\nexport function sum(a: number, b: number): number { return a + b; }\n<<<END_REPLACEMENT>>>' },
    stage: stageProposal,
  });
  assert.doesNotMatch(result.diff, /No newline at end of file/);
  await applyProposal(workspace, result.id, `APPLY ${result.id}`);
  assert.equal(await readFile(join(root, 'src', 'sum.ts'), 'utf8'), 'export function sum(a: number, b: number): number { return a + b; }\n');
});

test('EDIT preserves CRLF and trailing blank lines across stage/apply', async (t) => {
  const { root, workspace } = await fixture(t);
  const file = join(root, 'src', 'sum.ts');
  await writeFile(file, 'export const x = 1;\r\nexport const y = 2;\r\n\r\n');
  const result = await prepareEdit({
    workspace, file: 'src/sum.ts', instruction: 'Change x',
    client: { complete: async () => '<<<BEGIN_REPLACEMENT>>>\nexport const x = 3;\nexport const y = 2;\n<<<END_REPLACEMENT>>>' },
    stage: stageProposal,
  });
  await applyProposal(workspace, result.id, `APPLY ${result.id}`);
  assert.equal(await readFile(file, 'utf8'), 'export const x = 3;\r\nexport const y = 2;\r\n\r\n');
});

test('EDIT preserves missing newline in original even if model adds one', async (t) => {
  const { root, workspace } = await fixture(t);
  const file = join(root, 'src', 'sum.ts');
  await writeFile(file, 'export const x = 1;');
  const result = await prepareEdit({
    workspace, file: 'src/sum.ts', instruction: 'Change x',
    client: { complete: async () => '<<<BEGIN_REPLACEMENT>>>\nexport const x = 3;\n\n<<<END_REPLACEMENT>>>' },
    stage: stageProposal,
  });
  await applyProposal(workspace, result.id, `APPLY ${result.id}`);
  assert.equal(await readFile(file, 'utf8'), 'export const x = 3;');
});

test('EDIT preserves UTF-8 BOM; readWorkspaceFile hashes full byte representation', async (t) => {
  const { root, workspace } = await fixture(t);
  const file = join(root, 'src', 'sum.ts');
  await writeFile(file, '\uFEFFexport const x = 1;\n', 'utf8');
  const source = await readWorkspaceFile(workspace, 'src/sum.ts');
  assert.ok(source.content.startsWith('\uFEFF'));
  const result = await prepareEdit({
    workspace, file: 'src/sum.ts', instruction: 'Change x',
    client: { complete: async () => '<<<BEGIN_REPLACEMENT>>>\nexport const x = 3;\n<<<END_REPLACEMENT>>>' },
    stage: stageProposal,
  });
  await applyProposal(workspace, result.id, `APPLY ${result.id}`);
  assert.deepEqual(await readFile(file), Buffer.from('\uFEFFexport const x = 3;\n', 'utf8'));
});

test('EDIT rejects mixed source line endings and binary model replacements', async (t) => {
  const { root, workspace } = await fixture(t);
  const file = join(root, 'src', 'sum.ts');
  await writeFile(file, 'export const x = 1;\r\nexport const y = 2;\n');
  await assert.rejects(prepareEdit({
    workspace, file: 'src/sum.ts', instruction: 'Change x',
    client: { complete: async () => '<<<BEGIN_REPLACEMENT>>>\nexport const x = 3;\n<<<END_REPLACEMENT>>>' },
    stage: stageProposal,
  }), /Mixed LF\/CRLF/);
  await writeFile(file, 'export const x = 1;\n');
  await assert.rejects(prepareEdit({
    workspace, file: 'src/sum.ts', instruction: 'Change x',
    client: { complete: async () => '<<<BEGIN_REPLACEMENT>>>\nexport const x = 3;\0\n<<<END_REPLACEMENT>>>' },
    stage: stageProposal,
  }), /Binary replacement/);
});

#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { openWorkspace } from './src/workspace.mjs';
import { createOllamaClient } from './src/ollama.mjs';
import { ask, prepareEdit, review } from './src/runtime.mjs';
import { applyProposal, previewProposal, stageProposal } from './src/proposals.mjs';

const HELP = `Self-hosted Qwen Agent Core (experimental, local-only)

  node agent-core/cli.mjs ask --file README.md --question "Explain the architecture"
  node agent-core/cli.mjs review --diff changes.patch [--question "Check regressions"]
  node agent-core/cli.mjs edit --file docs/example.md --instruction "Improve this section"
  node agent-core/cli.mjs apply --proposal <id>

Options: --workspace <root> (default: current directory); repeat --file up to 4 times.
Agent Core has no autonomous shell tool execution and does not auto-parse tool JSON/XML.`;

function parseArgs(argv) {
  const [command, ...args] = argv;
  const values = { file: [] };
  const supported = new Set(['workspace', 'file', 'question', 'diff', 'instruction', 'proposal']);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!key?.startsWith('--') || !supported.has(key.slice(2)) || !args[i + 1]?.length) {
      throw new Error(`Invalid option: ${key ?? '<missing>'}`);
    }
    if (key === '--file') values.file.push(args[i + 1]);
    else values[key.slice(2)] = args[i + 1];
  }
  return { command, values };
}

async function main() {
  const { command, values } = parseArgs(process.argv.slice(2));
  if (!command || command === 'help' || command === '--help') {
    console.log(HELP);
    return;
  }
  if (!['ask', 'review', 'edit', 'apply'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const workspace = await openWorkspace(values.workspace || process.cwd());

  if (command === 'apply') {
    if (!input.isTTY) throw new Error('Applying changes requires an interactive terminal');
    const { diff } = await previewProposal(workspace, values.proposal);
    console.log(diff);
    console.log(`\nThis will update ONE existing file. No commands or tests will be executed.`);
    const rl = createInterface({ input, output });
    let approval;
    try {
      approval = await rl.question(`Type APPLY ${values.proposal} to confirm: `);
    } finally {
      rl.close();
    }
    const result = await applyProposal(workspace, values.proposal, approval);
    console.log(`APPLIED: ${result.relativePath}\nSHA256: ${result.hash}`);
    return;
  }

  const client = createOllamaClient();
  if (command === 'ask') {
    console.log(await ask({ workspace, files: values.file, question: values.question, client }));
  } else if (command === 'review') {
    console.log(await review({ workspace, diffPath: values.diff, question: values.question, client }));
  } else if (command === 'edit') {
    if (values.file.length !== 1) throw new Error('EDIT requires exactly one --file argument');
    const result = await prepareEdit({
      workspace,
      file: values.file[0],
      instruction: values.instruction,
      client,
      stage: stageProposal,
    });
    console.log(result.diff);
    console.log(`\nSTAGED ONLY: ${result.id}\nFile: ${result.relativePath}`);
    console.log(`To apply later: node agent-core/cli.mjs apply --proposal ${result.id}`);
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});

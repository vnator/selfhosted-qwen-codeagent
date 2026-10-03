#!/usr/bin/env node
// Read-only retrieval CLI: preview context before sending anything to the chat model.
import { openWorkspace } from './src/workspace.mjs';
import { createEmbedder, createQdrant } from './src/ingestion/clients.mjs';
import { createContextProvider } from './src/context/retriever.mjs';

function parseArgs(argv) {
  const opts = {};
  const supported = new Set(['workspace', 'repository', 'query', 'limit']);
  for (let i = 0; i < argv.length; i += 2) {
    const arg = argv[i];
    if (!arg?.startsWith('--') || !supported.has(arg.slice(2)) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error(`Invalid option: ${arg ?? '<missing>'}`);
    }
    opts[arg.slice(2)] = argv[i + 1];
  }
  if (!opts.repository || !opts.query) {
    throw new Error('Usage: node agent-core/context.mjs --workspace . --repository <ID> --query "question" [--limit 6]');
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const provider = createContextProvider({
    workspace: await openWorkspace(opts.workspace || process.cwd()),
    repositoryId: opts.repository,
    embedder: createEmbedder(),
    qdrant: createQdrant(),
    limit: opts.limit === undefined ? 6 : Number(opts.limit),
  });
  const sources = await provider.retrieve(opts.query);
  if (!sources.length) {
    console.error('NO CURRENT MATCHES: check the repository ID, the collection and whether this workspace needs reingestion.');
    process.exitCode = 2;
    return;
  }
  for (const source of sources) {
    console.log(`\n--- ${source.relativePath}:L${source.startLine}-L${source.endLine} (score ${source.score.toFixed(4)}) ---`);
    console.log(source.content);
  }
}
main().catch((error) => { console.error(`CONTEXT ERROR: ${error.message}`); process.exitCode = 1; });

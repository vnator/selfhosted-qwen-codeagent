#!/usr/bin/env node
import path from 'node:path';
import { createEmbedder, createQdrant } from './src/ingestion/clients.mjs';
import { indexWorkspace } from './src/ingestion/indexer.mjs';

const HELP = `Node.js ingestion (no Python / no inter-service bridge)
  node agent-core/ingest.mjs --workspace ingestion/knowledge_base --repository my-repo --dry-run
  node --env-file=.env agent-core/ingest.mjs --workspace ingestion/knowledge_base --repository my-repo
  node --env-file=.env agent-core/ingest.mjs --workspace ingestion/knowledge_base --repository my-repo --prune

Flags: --workspace <directory> --repository <stable-id> --extensions .rs,.c,.h
       --collection <collection> --model <embedding-model> --dry-run --prune
       --ollama-url <url> --qdrant-url <url>
Default collection: code_chunks_node_v1 (intentionally separate from legacy code_chunks).
Pruning is opt-in and limited to the given repository ID inside the selected collection.`;

function argsOf(args) {
  const result = { dryRun: false, prune: false };
  const options = new Set(['workspace', 'repository', 'extensions', 'collection', 'model', 'ollama-url', 'qdrant-url']);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') return { help: true };
    if (args[i] === '--dry-run') { result.dryRun = true; continue; }
    if (args[i] === '--prune') { result.prune = true; continue; }
    const key = args[i]?.startsWith('--') ? args[i].slice(2) : null;
    if (!options.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid/missing option: ${args[i]}`);
    result[key] = args[++i];
  }
  return result;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }
  if (!args.workspace || !args.repository) throw new Error(`--workspace and --repository are required.\n${HELP}`);
  const workspace = path.resolve(args.workspace);
  const embedder = createEmbedder({
    ...(args.model ? { model: args.model } : {}),
    ...(args['ollama-url'] ? { baseURL: args['ollama-url'] } : {}),
  });
  const qdrant = createQdrant({
    ...(args.collection ? { collection: args.collection } : {}),
    ...(args['qdrant-url'] ? { baseURL: args['qdrant-url'] } : {}),
  });
  console.log(`Workspace: ${workspace}\nRepository: ${args.repository}\nEmbedding: ${embedder.model}\nCollection: ${qdrant.collection}`);
  const result = await indexWorkspace({
    workspace,
    repositoryId: args.repository,
    dryRun: args.dryRun,
    prune: args.prune,
    extensions: args.extensions?.split(',').map((ext) => ext.trim()).filter(Boolean),
    embedder,
    qdrant,
    logger: console.log,
  });
  console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => { console.error(`INGEST ERROR: ${error.message}`); process.exitCode = 1; });

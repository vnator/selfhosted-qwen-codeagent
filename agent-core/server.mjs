#!/usr/bin/env node
// Standalone loopback transport. No editor dependencies and no arbitrary shell tool.
import { openWorkspace } from './src/workspace.mjs';
import { createOllamaClient } from './src/ollama.mjs';
import { createEmbedder, createQdrant } from './src/ingestion/clients.mjs';
import { createContextProvider } from './src/context/retriever.mjs';
import { ask, prepareEdit, review } from './src/runtime.mjs';
import { previewProposal, stageProposal } from './src/proposals.mjs';
import { createLocalApi } from './src/http/app.mjs';

async function main() {
  const token = process.env.AGENT_API_TOKEN;
  const root = process.env.AGENT_WORKSPACE;
  const repositoryId = process.env.AGENT_REPOSITORY;
  if (!root || !repositoryId) throw new Error('Set AGENT_WORKSPACE and AGENT_REPOSITORY');
  const workspace = await openWorkspace(root);
  const client = createOllamaClient();
  let provider;
  const api = createLocalApi({
    token,
    handlers: {
      ask: async ({ question, files, context }) => {
        let sources = [];
        if (context === 'auto') {
          provider ||= createContextProvider({
            workspace, repositoryId, embedder: createEmbedder(), qdrant: createQdrant(), limit: 6,
          });
          sources = await provider.retrieve(question);
          if (!sources.length && !files.length) throw new Error('No valid indexed sources; reingest first');
        }
        const answer = await ask({ workspace, files, contextSources: sources, question, client });
        return {
          answer,
          sources: sources.map(({ relativePath, startLine, endLine, score }) => ({
            relativePath, startLine, endLine, score,
          })),
        };
      },
      review: async ({ diff, question }) => ({
        answer: await review({ workspace, diffPath: diff, question, client }),
      }),
      propose: ({ file, instruction }) => prepareEdit({
        workspace, file, instruction, client, stage: stageProposal,
      }),
      preview: async (id) => {
        const { proposal, diff } = await previewProposal(workspace, id);
        return { id, file: proposal.relativePath, diff, createdAt: proposal.createdAt };
      },
    },
  });
  const port = Number(process.env.AGENT_API_PORT || '8765');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid AGENT_API_PORT');
  api.listen(port, '127.0.0.1', () => {
    console.log(`Qwen Agent API listening at http://127.0.0.1:${port}`);
    console.log(`Workspace: ${workspace.root}; repository: ${repositoryId}`);
    console.log('APPLY is intentionally CLI-only (interactive confirmation).');
  });
}
main().catch((error) => {
  console.error(`AGENT API ERROR: ${error.message}`);
  process.exitCode = 1;
});

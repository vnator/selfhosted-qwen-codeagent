# Phase 04 — Read-only Context Engine (Node.js only)

This phase does not touch the old Qdrant collection `code_chunks`, delete ingestion data, edit source files, or execute LLM tool calls.

## Configuration

Use the same `.env` variables already used for indexing: `OLLAMA_URL`, `EMBEDDING_MODEL`, `QDRANT_URL`, `QDRANT_COLLECTION`. The existing Node index is named `code_chunks_node_v1` and your stable repository ID is `selfhosted-qwen-codeagent`.

## First run — inspect retrieval *without* invoking the chat model

```sh
node --env-file=.env agent-core/context.mjs \
  --workspace . \
  --repository selfhosted-qwen-codeagent \
  --query 'Where is the EDIT approval mechanism implemented?' \
  --limit 6
```

The retrieval client checks that each Qdrant point has the correct repository ID and embedding model, then re-reads the local file using the existing workspace guard. It excludes missing, inaccessible, stale or tampered content instead of trusting the vector store as an authority.

## Second run — ASK with automatically retrieved context

```sh
node --env-file=.env agent-core/cli.mjs ask \
  --workspace . \
  --repository selfhosted-qwen-codeagent \
  --context auto \
  --limit 6 \
  --question 'Where is the EDIT approval mechanism implemented? Cite file paths and line ranges.'
```

The previous `ask --file ...` path remains available, and may be combined with `--context auto`. If an indexed file has changed locally, run ingestion again (same arguments as before, *without* `--prune` during normal development). No matches triggers an error rather than a fabricated answer.

## Validation

```sh
(cd agent-core && npm test)
```

The `--context auto` path is **read-only ASK**. EDIT is still explicitly scoped to one file and APPLY still requires exact interactive confirmation. Reindexing and pruning stay separate and explicit.

## Important

Do not delete `ingestion/ingest.py` blindly if something still runs it. Once the Node ingestion and retrieval are verified and all jobs/documentation refer exclusively to Node, remove that legacy file and its Python-specific dependencies in a separate cleanup commit. Keep existing Qdrant volumes and the legacy collection until a deliberate cleanup decision.

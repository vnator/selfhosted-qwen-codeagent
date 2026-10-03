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

### Source-aware selection (Phase 06)

A vector-only top-6 produced six documentation excerpts for an implementation question and did not include the implementation. The retriever now fetches up to 48 *candidate* points from Qdrant, validates every candidate against the current workspace, and re-ranks the eligible entries using lexical matches plus vector similarity. For questions explicitly about implementation, it reserves up to half the final context for matching source-code excerpts. Selection also prefers distinct files and suppresses largely overlapping ranges. The same byte budget and workspace/embedding-model isolation still apply.

This is **re-ranking within the Qdrant candidate pool**, not yet a standalone lexical index: code omitted entirely from the first 48 vector candidates cannot be recovered. For an exact implementation question, `ask --context auto --file agent-core/src/proposals.mjs ...` remains a deterministic fallback until independent lexical/symbol discovery is added. Never bypass workspace checks to improve recall.

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

The application runtime and ingestion are Node.js only. Check `node scripts/check-no-python.mjs` for legacy implementation artifacts. Keep existing Qdrant volumes and the legacy collection until a separate, deliberate cleanup decision.

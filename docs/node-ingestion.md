# Node.js ingestion (Phase 03)

The ingestion code now lives **inside Agent Core** (`agent-core/src/ingestion/`). There is no Python process, Python package manager, HTTP bridge, or second application service.

## What was migrated

The former `ingestion/ingest.py` scans `knowledge_base`, selects Rust (`.rs`) and C (`.c`, `.h`), chunks at 800 characters with overlap 100, embeds through Ollama and indexes in Qdrant. The Node port keeps that initial scope. Its line-aware chunker is intentionally not byte-identical to LangChain's Python language splitters. It adds deterministic UUID-shaped point IDs, file hashes, chunk hashes, source-relative paths, line spans, repository ID and chunker/model provenance.

The port uses Ollama's batch-capable `/api/embed` endpoint. No npm dependencies are required on Node 22+ (Node 24 is fine). The embedding model is `nomic-embed-text:latest` by default and must be installed separately; this is not the 7B chat model or the 1.5B suggestion model.

## Install/validate

From the repository root, after merging this package:

```sh
node --version # >=22
cd agent-core && npm test && cd ..
docker exec agent_ollama ollama list
# Only if nomic-embed-text:latest is not present:
docker exec agent_ollama ollama pull nomic-embed-text:latest
```

Make sure `agent_ollama` and `agent_qdrant` are running (the WebUI is unnecessary). Confirm their host ports 11434 and 6333.

Set optional values in your **existing** root `.env` (never commit that file):

```dotenv
OLLAMA_URL=http://127.0.0.1:11434
QDRANT_URL=http://127.0.0.1:6333
EMBEDDING_MODEL=nomic-embed-text:latest
QDRANT_COLLECTION=code_chunks_node_v1
```

## Commands

The `--workspace` path is explicit; choose the actual directory containing the source corpus. The old Python script's `./knowledge_base` path depended on its working directory. `--repository` must remain stable across runs for deterministic reindexing.

```sh
# No Ollama/Qdrant calls are made by a dry run:
node agent-core/ingest.mjs --workspace ingestion/knowledge_base --repository my-repo --dry-run

# Live indexing; run from the repo root, with your existing .env if needed:
node --env-file=.env agent-core/ingest.mjs --workspace ingestion/knowledge_base --repository my-repo

# Same invocation again should mark unchanged files SKIP and not re-embed them.
node --env-file=.env agent-core/ingest.mjs --workspace ingestion/knowledge_base --repository my-repo

# Optional: remove stale points for DELETED files in this repository and collection.
# Never set --prune against an unintended corpus root.
node --env-file=.env agent-core/ingest.mjs --workspace ingestion/knowledge_base --repository my-repo --prune
```

Extensions default to `.rs,.c,.h` exactly as in the Python source. `--extensions .rs,.c,.h,.js,.ts,.tsx,.jsx,.lua,.md` opts into more; those additional languages currently use the same deterministic line-aware fallback, not a syntax-tree splitter. Existing directory exclusions include `.git`, `node_modules`, build outputs and hidden directories; symlinks and invalid UTF-8/binary files are skipped. This first version does NOT parse custom `.gitignore` rules; scope the corpus explicitly and do not include sensitive files.

## Collection migration / data safety

The legacy Python index uses `code_chunks` with random UUIDs and minimal metadata. This port defaults to **`code_chunks_node_v1`**, a separate collection, and never deletes or converts legacy points. It is safe to validate the new index while retaining the old one.

Only after verifying that Node has indexed the intended corpus, retire the Python source:

```sh
git ls-files ingestion
git rm ingestion/ingest.py
# Remove Python-only dependency manifests too, but only if present and used solely by ingestion.
# Keep ingestion/knowledge_base and all Docker volumes.
```

Do not delete `code_chunks` automatically. If the old collection must eventually be retired, first export/back it up and verify that no consumer still references it. Updating retrieval to query the new collection is a separate next step.

## Incremental behavior

- Identical reingestion has the same IDs and skips vector generation.
- Edited files: obtain all new vectors, upsert new points, then remove stale IDs after successful upsert.
- Removed files: remove their points only with explicit `--prune`, scoped to the repository ID within the configured collection. Pruning an empty corpus is refused.
- A network failure stops the job; it does not trigger repository-wide pruning. A failed deletion after upsert may leave temporary duplicate points; rerun to reconcile.
- Incompatible embedding model or vector dimensions fail rather than silently mixing vectors.
- File payload carries `repository_id`, `relative_path`, `language`, `start_line`, `end_line`, `source_hash`, `chunk_hash`, `chunker_version`, `embedding_model`, `ingested_at`, `content`.

## Follow-up

Phase 04 is a Node `ContextProvider` that embeds the query with the **same model**, queries this collection with a mandatory `repository_id` filter, limits retrieved text to a token budget, and passes source references into ASK/REVIEW. No Python↔Node bridge is needed.

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
# Validated example: index this repository itself (no Ollama/Qdrant calls in dry run).
node agent-core/ingest.mjs --workspace . --repository selfhosted-qwen-codeagent \
  --extensions .mjs,.js,.md,.yml,.yaml --dry-run

# Live indexing from the repository root, with exactly the same corpus definition.
node --env-file=.env agent-core/ingest.mjs --workspace . --repository selfhosted-qwen-codeagent \
  --extensions .mjs,.js,.md,.yml,.yaml

# Repeat the same command to confirm that unchanged files are SKIP.
# Use an absolute --workspace and a different stable --repository for other projects.
# Use --prune only after verifying the intended corpus root and repository ID.
```

Extensions default to `.rs,.c,.h` exactly as in the Python source. `--extensions .rs,.c,.h,.js,.ts,.tsx,.jsx,.lua,.md` opts into more; those additional languages currently use the same deterministic line-aware fallback, not a syntax-tree splitter. Existing directory exclusions include `.git`, `node_modules`, build outputs and hidden directories; symlinks and invalid UTF-8/binary files are skipped. This first version does NOT parse custom `.gitignore` rules; scope the corpus explicitly and do not include sensitive files.

## Collection migration / data safety

The legacy Python index uses `code_chunks` with random UUIDs and minimal metadata. This port defaults to **`code_chunks_node_v1`**, a separate collection, and never deletes or converts legacy points. It is safe to validate the new index while retaining the old one.

The live Node ingestion has been validated (`code_chunks_node_v1`: 138 points from 25 files; second run: 25 SKIP). The previous executable `ingestion/ingest.py` can now be removed from Git. Inspect all tracked implementation artifacts first:

```sh
node scripts/check-no-python.mjs
# This specific legacy ingester has a validated Node replacement:
git rm -- ingestion/ingest.py
node scripts/check-no-python.mjs
```

If any additional Python scrapers or dependency manifests are reported, migrate their behavior into Node before removing the files. Preserve source corpora, Docker volumes and Qdrant collections.

Do not delete `code_chunks` automatically. If the old collection must eventually be retired, first export/back it up and verify that no consumer still references it. Updating retrieval to query the new collection is a separate next step.

## Incremental behavior

- Identical reingestion has the same IDs and skips vector generation.
- Edited files: obtain all new vectors, upsert new points, then remove stale IDs after successful upsert.
- Removed files: remove their points only with explicit `--prune`, scoped to the repository ID within the configured collection. Pruning an empty corpus is refused.
- A network failure stops the job; it does not trigger repository-wide pruning. A failed deletion after upsert may leave temporary duplicate points; rerun to reconcile.
- Incompatible embedding model or vector dimensions fail rather than silently mixing vectors.
- File payload carries `repository_id`, `relative_path`, `language`, `start_line`, `end_line`, `source_hash`, `chunk_hash`, `chunker_version`, `embedding_model`, `ingested_at`, `content`.

## Follow-up

Phase 04 is implemented in `agent-core/src/context/retriever.mjs`, exposed by `agent-core/context.mjs` and `cli.mjs ask --context auto`. Live retrieval against Qdrant should be tested after any ingestion change. There is no Python↔Node bridge.

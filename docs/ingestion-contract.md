# Ingestion pipeline contract (proposed checklist)

The public `main` snapshot reviewed for this proposal does not expose the newer ingestion implementation. Apply this document as an interface/checklist, not as a replacement for code already created in another branch.

## Pipeline stages

1. **Discover:** explicit repository roots and allowlisted file types; respect `.gitignore` where applicable. Exclude `.git`, build outputs, dependency caches, credentials, `.env` files and configured private patterns. Do not follow links outside approved roots.
2. **Extract:** capture text, source-relative path, language and content hash. Preserve source provenance; document behavior for unsupported or binary files.
3. **Chunk:** prefer logical boundaries (functions/classes/sections) where available; record line spans and chunker version. Allow a deterministic fallback for languages without a parser.
4. **Embed:** make embedding model and dimension part of collection configuration. Avoid mixing vectors from incompatible models in one collection.
5. **Index:** upsert stable chunk IDs and metadata into Qdrant. Maintain an ingestion manifest so changed/deleted files can be reconciled.
6. **Retrieve:** enforce repository/workspace filters before ranking; return file path, line span, hash and score with each result. Bound the final context budget.
7. **Evaluate:** test recall with known queries, stale-index behavior, deletion, duplicate handling and accidental sensitive-file inclusion.

## Suggested Qdrant payload per chunk

```json
{
  "repository_id": "stable-project-id",
  "relative_path": "lua/plugins/minuet.lua",
  "language": "lua",
  "start_line": 1,
  "end_line": 40,
  "source_hash": "sha256-of-source",
  "chunk_hash": "sha256-of-chunk",
  "chunker_version": "v1",
  "embedding_model": "model-and-version",
  "ingested_at": "ISO-8601 timestamp"
}
```

Use a stable ID derived from repository identity + path + chunk identity/version. If chunk boundaries are unstable between versions, make that change explicit and reindex. This schema is a proposal and should be reconciled with the existing implementation.

## Acceptance scenarios

- Re-ingesting an unchanged file produces no duplicate chunks.
- Editing one file updates only affected indexed content according to the chosen chunking policy.
- Deleting or excluding a file removes its stale records.
- Retrieval never crosses an explicitly selected repository boundary.
- Every answer grounded in retrieval can identify its file and line range.
- Ingestion failures are visible and retryable; no claim of success is made after a partial batch fails.

Qdrant alone is not ingestion: document the embedding model, parser/chunker, job lifecycle and reconciliation policy as separate services/modules.

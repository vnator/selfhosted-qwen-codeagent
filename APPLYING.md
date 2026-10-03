# Phase 1: additive foundation bundle

Source reviewed: public `main` of `vnator/selfhosted-qwen-codeagent` on 2026-10-03. An ingestion branch may contain newer local files not visible in that snapshot.

This bundle intentionally contains **only new files**. It does not overwrite `docker-compose.yml`, `readme.md`, `roadmap.md`, ingestion code, or named Docker volumes.

## Apply to your checkout

1. Review the files, particularly `docs/ingestion-contract.md`, against your current ingestion implementation.
2. From the directory containing this archive:

   ```bash
   unzip -n selfhosted-qwen-codeagent-phase-1.zip -d /path/to/selfhosted-qwen-codeagent
   ```

   `-n` skips existing files. To extract a copy for review instead, use a disposable directory.
3. In the repository:

   ```bash
   bash -n scripts/check-infra.sh tests/test-tool-calling.sh
   ./scripts/check-infra.sh
   ./tests/test-tool-calling.sh  # a nonzero exit is the documented current regression
   git status --short
   ```

4. Commit only the reviewed additions. Suggested subject:

   `docs(agent): define architecture, ingestion and execution contracts`

## Next proposed change

Once the current ingestion branch/commit is available, align `docs/ingestion-contract.md` to its actual source connectors, metadata, embeddings, collection naming and job lifecycle, then add a small fixture for incremental upsert/delete and retrieval grounding. Only then refactor Compose and update the main roadmap.

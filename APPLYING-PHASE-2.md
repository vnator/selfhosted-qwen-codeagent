# Phase 2 — standalone Agent Core (additive)

This archive adds only `agent-core/` and this application guide. It leaves
Docker Compose, the original README/roadmap, the Phase 1 docs/scripts/tests,
all ingestion code, and Docker named volumes unchanged.

## Apply

From the existing checkout root (use `pwd`; do not assume the public repository
has exactly the same name as your local folder):

```bash
unzip -n /path/to/selfhosted-qwen-codeagent-phase-2.zip -d .
cd agent-core
npm test
cd ..
node --env-file=.env agent-core/cli.mjs ask \
  --file docker-compose.yml \
  --question 'Describe this infrastructure using only the supplied file.'
```

Optional: create `docs/example.md` in a disposable branch and try EDIT;
keep this experimental workflow off valuable source files until validated.

Inspect the resulting working-tree additions and stage narrowly:

```bash
git status --short
git add agent-core/
git diff --cached --check
git commit -m 'feat(agent): add guarded local ask review and edit runtime'
```

The recorded Phase 1 `tests/test-tool-calling.sh` failure is independent of this
implementation; do not mark autonomous Tool Calling as completed.

## Next development slice

Introduce an ingestion Context Provider contract, after inspecting the *actual*
local ingestion files. Then add incremental retrieval tests with repository
filters and provenance, followed by a local HTTP/CLI adapter. Do not change
collection payloads or Qdrant volumes from assumptions.

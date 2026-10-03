# Phase 07 — Node.js local integration API (additive)

This package contains **only new paths**. It does not overwrite Compose, ingestion, Python scrapers, existing Agent Core files, or Qdrant collections. The Python cleanup can be done separately after checking the collectors' behavior.

## 1. Apply from repository root

```bash
# Run in ~/dev/selfhosted-qwen27-codeagent or the actual clone path.
git status --short
# If any destination already exists, stop and reconcile before copying.
test ! -e agent-core/server.mjs && test ! -e agent-core/src/http/app.mjs
unzip -n "$HOME/Downloads/selfhosted-qwen-codeagent-phase-07.zip" -d .
(cd agent-core && npm test)
node --check agent-core/server.mjs
node --check agent-core/src/http/app.mjs
git diff --check
```

Tests are local and stub Ollama/Qdrant. Also run the live API smoke test below against your running containers.

## 2. Start API, repository-scoped

```bash
mkdir -p "$HOME/.config/qwen-codeagent"
chmod 700 "$HOME/.config/qwen-codeagent"
(umask 077; test -s "$HOME/.config/qwen-codeagent/token" || openssl rand -hex 32 > "$HOME/.config/qwen-codeagent/token")
export AGENT_API_TOKEN="$(cat "$HOME/.config/qwen-codeagent/token")"
export AGENT_WORKSPACE="$PWD"
export AGENT_REPOSITORY=selfhosted-qwen-codeagent
node --env-file=.env agent-core/server.mjs
```

## 3. Smoke test in second terminal

```bash
TOKEN="$(cat "$HOME/.config/qwen-codeagent/token")"
curl -fsS http://127.0.0.1:8765/v1/health -H "Authorization: Bearer $TOKEN" | jq
curl -fsS http://127.0.0.1:8765/v1/ask \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"question":"Where is EDIT approval implemented? Cite files and line ranges.","context":"auto"}' | jq
```

For edit proposal, choose an EXISTING disposable file within the configured workspace (the endpoint does NOT apply changes):

```bash
curl -fsS http://127.0.0.1:8765/v1/edits/propose \
 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
 -d '{"file":"docs/example.md","instruction":"Fix a typo only."}' | jq
```

Replace docs/example.md with a real disposable file. To apply, run `node agent-core/cli.mjs apply --workspace "$AGENT_WORKSPACE" --proposal <uuid>` in an INTERACTIVE terminal and type the exact confirmation; there is deliberately no HTTP apply endpoint.

## 4. Commit

```bash
git add agent-core/server.mjs agent-core/src/http/app.mjs agent-core/test/local-api.test.mjs docs/local-api.md
 git diff --cached --check
 git commit -m "feat(api): expose bounded local agent endpoints"
```

Next: create a thin Vim client that reads the token file and requests this API; do not install another agent framework. Python scrapers to be ported to Node and removed in a separate, independently tested commit. No Qdrant deletion is required.

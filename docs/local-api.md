# Local Agent API (initial transport)

Node.js only, bound to `127.0.0.1`, with a fixed workspace and repository set at startup. Never expose this service via `0.0.0.0`, a public reverse proxy, or a port-forward.

## Start (from repository root)

```bash
mkdir -p "$HOME/.config/qwen-codeagent"
chmod 700 "$HOME/.config/qwen-codeagent"
(umask 077; test -s "$HOME/.config/qwen-codeagent/token" || openssl rand -hex 32 > "$HOME/.config/qwen-codeagent/token")
export AGENT_API_TOKEN="$(cat "$HOME/.config/qwen-codeagent/token")"
export AGENT_WORKSPACE="$PWD"
export AGENT_REPOSITORY=selfhosted-qwen-codeagent
node --env-file=.env agent-core/server.mjs
```

Keep the terminal open. In another terminal:

```bash
TOKEN="$(cat "$HOME/.config/qwen-codeagent/token")"
curl -fsS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8765/v1/health | jq
curl -fsS http://127.0.0.1:8765/v1/ask \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"question":"Where is the EDIT approval mechanism implemented?", "context":"auto"}' | jq
```

## Endpoints

| Request | JSON input | Notes |
| --- | --- | --- |
| `GET /v1/health` | none | Service health and declared capabilities |
| `POST /v1/ask` | `{ "question": "...", "context": "auto" }` or `files: [...]` | Returns `answer` and source references; if `files` supplied, default `context` is `none` |
| `POST /v1/review` | `{ "diff": "changes.diff", "question": "..." }` | `diff` is an existing, workspace-relative text file |
| `POST /v1/edits/propose` | `{ "file": "math.ts", "instruction": "..." }` | STAGES ONLY; response contains `id`, `diff` and `relativePath` |
| `GET /v1/edits/<uuid>` | none | Previews only; rejects stale or invalid proposals |

No HTTP APPLY route exists. To approve a proposal, use the existing CLI in an interactive terminal:

```bash
node agent-core/cli.mjs apply --workspace "$AGENT_WORKSPACE" --proposal <uuid>
```

Typing `APPLY <uuid>` is a separate human action. JSON/XML printed by the LLM is never interpreted as permission to run commands or edit files.

Security constraints: loopback-only bind, bearer token required even for health, no browser origins/CORS, fixed workspace, maximum request size of 16 KiB, at most one concurrent model operation. The API is designed for trusted local terminal/editor clients only. Rotate/delete the token if it is exposed.

## Live smoke-test status (2026-10-03)

Validated on the local deployment by the project maintainer:

- `GET /v1/health` with a valid bearer token returned `status: ok`, capabilities
  `ask`, `review`, `edit-propose`, `edit-preview`, and `apply: interactive-cli-only`.
- `POST /v1/ask` with `context: auto` returned an answer and six structured
  source references from the indexed repository.
- **Important limitation:** a model-generated answer is not verified provenance.
  In the live EDIT-approval query, the answer referred to `applyProposal` even
  though the actual implementation range in `src/proposals.mjs` was absent from
  the returned `sources`. Consumers must display the API's `sources` independently
  and must not present an unsupported model citation as verified evidence. The
  current `sources` array lists automatically retrieved chunks only; explicitly
  supplied `files` are sent to ASK, but are not separately echoed in this array.
- Live HTTP `review`, `edits/propose` and `edits/<uuid>` remain to be smoke-tested
  against a disposable workspace file. Unit tests cover these routes.

For a more reliable answer about a known implementation, provide the exact file(s)
explicitly, avoiding reliance on vector retrieval alone:

```bash
TOKEN="$(cat "$HOME/.config/qwen-codeagent/token")"
curl -fsS http://127.0.0.1:8765/v1/ask \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "Explain EDIT approval using only the supplied source files. Cite the actual code lines. Say when the context is insufficient.",
    "files": ["agent-core/cli.mjs", "agent-core/src/proposals.mjs"],
    "context": "none"
  }' | jq
```

### Safe HTTP staging smoke test

The API is restricted at server startup to `AGENT_WORKSPACE`. Run these commands
from that exact workspace root; create a disposable file before proposing edits:

```bash
mkdir -p agent-smoke
printf 'export function add(a: number, b: number) {\n  return a + b;\n}\n' > agent-smoke/math.ts
TOKEN="$(cat "$HOME/.config/qwen-codeagent/token")"
curl -fsS http://127.0.0.1:8765/v1/edits/propose \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "file": "agent-smoke/math.ts",
    "instruction": "Add an explicit number return type without changing behavior."
  }' | tee /tmp/qwen-api-proposal.json | jq
PROPOSAL_ID="$(jq -er '.id' /tmp/qwen-api-proposal.json)"
curl -fsS "http://127.0.0.1:8765/v1/edits/$PROPOSAL_ID" \
  -H "Authorization: Bearer $TOKEN" | jq
cat agent-smoke/math.ts  # Must still have its original content.
```

No HTTP APPLY endpoint exists. Approval and application remain separate CLI actions.
Do not commit the bearer token, `.env`, generated proposal files or the disposable
`agent-smoke/` directory. Clean up only the disposable file after testing.

### Integration limitations

The current server uses one fixed workspace/repository per process. For a different
project, start a separate instance with the corresponding `AGENT_WORKSPACE`,
`AGENT_REPOSITORY` and port, and ingest that repository first. A general multi-workspace
registry and independent lexical/symbol retrieval are future work.

# Agent Core — experimental MVP 0.2

A standalone, local-first coding workflow independent of editors and Open WebUI.
Explicit-file ASK requires only Ollama; opt-in `ASK --context auto` uses the Node
ingestion index and Qdrant. Requires **Node.js 22+ and standard library only**.
It deliberately does **not** claim autonomous tool use.

## What works in this slice

| Mode | Operation | Side effects |
| --- | --- | --- |
| ASK | Answer from up to four selected files or opt-in read-only retrieved context | None |
| REVIEW | Analyze a supplied `.diff` or `.patch` file | None |
| EDIT | Ask Ollama for one complete-file replacement, validate markers and stage a unified diff | Creates an owner-only proposal in local state, not a repository edit |
| APPLY | Preview the staged diff, compare source hash, ask for exact approval, atomically replace ONE existing text file | Only on explicit approval |

No autonomous shell commands, model-generated JSON tool dispatch or HTTP server
are enabled. RAG retrieval is opt-in (`--context auto`) and does not run ingestion. An editing proposal is **not** proof
of tool calling. The current known Qwen 7B/Ollama 0.33.3 limitation remains
tracked separately in `tests/test-tool-calling.sh`.

## Requirements

- Node.js 22+; `diff` (GNU/BSD) for unified diff previews.
- Running Ollama on a loopback endpoint (default `http://127.0.0.1:11434`).
- Existing `qwen2.5-coder:7b` model (no new downloads required).

The optional repository-level `.env` from Phase 1 contains:

```ini
OLLAMA_URL=http://127.0.0.1:11434
AGENT_MODEL=qwen2.5-coder:7b
AGENT_CONTEXT=16384
```

Node does not automatically load `.env`. On Node 22+/24, invoke the CLI from
this repository's root with `node --env-file=.env agent-core/cli.mjs ...`, or
export the variables normally. Do not commit `.env`.

## First run (safe ASK)

From the repository root, first use a **small, explicit text file**:

```bash
node --env-file=.env agent-core/cli.mjs ask \
  --file docker-compose.yml \
  --question 'Describe the infrastructure. Cite lines and do not infer an agent runtime.'
```

Review a local diff or patch, without reading arbitrary workspace files:

```bash
node --env-file=.env agent-core/cli.mjs review \
  --diff changes.patch \
  --question 'Identify possible regressions.'
```

## EDIT: stage first, never auto-apply

Use an existing, preferably disposable file. There is a conservative 12 KiB
limit on editable source files, because this uses a 7B model and whole-file
replacement rather than a reliable structured tool-call protocol.

```bash
node --env-file=.env agent-core/cli.mjs edit \
  --file docs/example.md \
  --instruction 'Make the introduction more concise without changing its meaning.'
```

The CLI displays a unified diff and prints `STAGED ONLY: <id>`. It has not
modified `docs/example.md`. The proposal is stored **outside the Git checkout**
under `${XDG_STATE_HOME:-~/.local/state}/selfhosted-qwen-codeagent/<workspace-hash>/proposals/`, with owner-only permissions. Override the parent directory using `AGENT_STATE_DIR` if needed.

After reviewing the diff, explicitly apply one proposal:

```bash
node agent-core/cli.mjs apply --proposal <id>
```

This requires an interactive TTY. The program previews the diff again, then
asks you to type the exact phrase `APPLY <id>`. It rejects stale proposals
when the underlying source content has changed. It does not run tests, create
commits, or execute model-provided shell commands.

## Tests

```bash
cd agent-core
npm test
```

Tests use a fake inference client / mocked HTTP responses and temporary
repositories. They never contact Ollama, alter the real workspace, or execute
textual JSON/XML as actions. The existing Phase 1 tool-call diagnostic is an
independent integration test; it can continue to report `FAIL` until the
inference compatibility issue is resolved.

## Explicit limits

- Designed for a trusted, single-user local host; not yet hardened against
  concurrent hostile OS processes or untrusted multi-user service access.
- Reads only explicitly selected allowlisted UTF-8 text files within the
  workspace; secrets and symlinks are denied by conservative checks.
- Automatic retrieval is **opt-in** via `ASK --context auto`. This never starts
  ingestion and does not grant file access; retrieved content is untrusted and
  checked against current, authorized workspace files before use.
- The model can produce an inaccurate edit: inspect the diff and run relevant
  project tests manually after applying.

## Phase 04 — read-only retrieved context (Node.js)

The Node.js ingestion creates `code_chunks_node_v1`. The Context Engine retrieves only
chunks matching the explicit repository ID and embedding model and revalidates each
chunk against the *current* file inside `--workspace` (using the existing workspace
read policy). Missing, stale, private and tampered hits are discarded. A single file
greater than the Agent Core's existing 64 KiB read limit is also excluded; split or
scope those workspaces until larger-file reads receive their own review.

Inspect retrieval separately:

```sh
node --env-file=.env agent-core/context.mjs --workspace . \
  --repository selfhosted-qwen-codeagent \
  --query 'Where is the EDIT approval mechanism implemented?' --limit 6
```

Ask with automatic, read-only context:

```sh
node --env-file=.env agent-core/cli.mjs ask --workspace . \
  --context auto --repository selfhosted-qwen-codeagent \
  --question 'Where is the EDIT approval mechanism implemented?'
```

Explicit `ask --file` remains available. This mode does not give the model tool
execution or modify EDIT/APPLY behavior. See `docs/context-engine.md`.

## File-layout integrity (Phase 05)

EDIT normalizes the model's proposed replacement to the **existing file's** UTF-8 BOM,
LF/CRLF convention, and final newline sequence before hashing or staging the diff.
Mixed LF/CRLF and CR-only sources are rejected rather than silently reformatted.
Applying an EDIT remains proposal-specific, interactive, and subject to the original
file hash. Run `npm test` after upgrading. Deliberate line-ending changes should be
made by an explicit formatting tool outside EDIT, not accidentally by the model.

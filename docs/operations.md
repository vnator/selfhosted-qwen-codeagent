# Local operations (Node.js only)

The repository-root `package.json` is the operator entrypoint. Node.js 22+, Docker
Compose and an existing checkout are required. No extra npm dependencies or shell
runtime are installed. `agent:up` invokes the existing `agent-core/server.mjs`.

## 1. Core infrastructure

From the repository root:

```bash
npm run infra:up       # Ollama + Qdrant in the background; leaves Open WebUI optional
npm run infra:status   # Requires running from this repository (Compose file here)
```

These commands retain existing Docker volumes. To stop Ollama/Qdrant deliberately:

```bash
npm run infra:stop
```

Do not stop the inference services while another consumer still needs them.

## 2. Agent over this repository (port 8765)

```bash
npm run agent:ingest -- --dry-run
npm run agent:ingest
npm run agent:up
```

`agent:up` is **foreground**, not a daemon. Keep its terminal open; Ctrl+C stops
this API process. In another terminal:

```bash
npm run agent:health
```

The first startup creates `~/.config/qwen-codeagent/token` with private permissions
(0600; directory 0700) if necessary. The existing token is reused, so the Neovim
client remains compatible. Do not commit this token. The API binds to
`127.0.0.1` only; all file operations stay within the selected workspace.

If an API already listens on port 8765, use `agent:health` rather than trying
to start a second one on that port.

## 3. Agent over a different repository, e.g. vim-grimory (port 8766)

From the **selfhosted-qwen-codeagent repository root**, first index the target:

```bash
npm run agent:ingest -- \
  --workspace "$HOME/dev/vim-grimory" \
  --repository vim-grimory \
  --extensions .lua,.md,.json,.toml,.yml,.yaml
```

Then run the API in another terminal, also from the agent's root:

```bash
npm run agent:up -- \
  --workspace "$HOME/dev/vim-grimory" \
  --repository vim-grimory \
  --port 8766
```

From any terminal at the agent root, check:

```bash
npm run agent:health -- --port 8766
```

Keep the workspace and repository ID consistent between `agent:ingest` and
`agent:up`; do not reuse the wrong index. Separate ports can serve separate
workspaces concurrently, both using the same private bearer token.

## 4. Propose via HTTP; apply only via interactive CLI

To approve a proposal previously staged by the API:

```bash
npm run agent:apply -- \
  --workspace "$HOME/dev/vim-grimory" \
  --proposal REPLACE_WITH_REAL_UUID
```

The CLI displays the diff and requires typing `APPLY <UUID>`. No HTTP APPLY route
exists, and model-generated JSON/XML must not be treated as executable tools.

## 5. Tests and cautions

```bash
npm test
node scripts/check-no-python.mjs
```

`agent:ingest` updates modified files incrementally; it NEVER prunes deleted
records unless `--prune` is explicitly given. For project-specific extensions
pass `--extensions`. Legacy Python collection `code_chunks` is untouched.

The `.env` file is read from the **agent repository root** by the Node operator
script, regardless of which workspace the agent serves. Do not expose the API
outside local loopback or commit `.env`/tokens. The Open WebUI is optional and
is not started by `infra:up`.

Use `npm run agent:up -- --help` to see all operator options.

#!/usr/bin/env node
// Operator entrypoint for the existing Node.js Agent Core. No additional npm dependencies.
import { randomBytes } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, realpathSync,
  statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const DEFAULT_REPOSITORY = 'selfhosted-qwen-codeagent';
const DEFAULT_EXTENSIONS = '.mjs,.js,.ts,.tsx,.jsx,.lua,.rs,.c,.h,.cpp,.hpp,.md,.json,.toml,.yml,.yaml';
const TOKEN_FILE = process.env.AGENT_TOKEN_FILE || join(homedir(), '.config/qwen-codeagent/token');

const HELP = `Usage (from this repository root):
  npm run infra:up
  npm run agent:up                      # foreground API, port 8765; Ctrl+C stops it
  npm run agent:health
  npm run agent:ingest [-- --dry-run]   # never prunes unless --prune is explicit
  npm run agent:apply -- --proposal UUID

  # Another workspace, e.g. Grimory (index it before starting its API):
  npm run agent:ingest -- --workspace "$HOME/dev/vim-grimory" --repository vim-grimory --extensions .lua,.md,.json,.toml,.yml,.yaml
  npm run agent:up -- --workspace "$HOME/dev/vim-grimory" --repository vim-grimory --port 8766
  npm run agent:health -- --port 8766
  npm run agent:apply -- --workspace "$HOME/dev/vim-grimory" --proposal UUID

Supported flags:
  up:     --workspace DIR --repository ID --port NUMBER
  health: --port NUMBER
  ingest: --workspace DIR --repository ID --extensions CSV --dry-run --prune
          --collection NAME --model NAME --ollama-url URL --qdrant-url URL
  apply:  --workspace DIR --proposal UUID
The API binds to 127.0.0.1 only. APPLY is always interactive and never exposed by HTTP.
`;

const ALLOWED = {
  up: new Set(['workspace', 'repository', 'port']),
  health: new Set(['port']),
  ingest: new Set(['workspace', 'repository', 'extensions', 'dry-run', 'prune', 'collection', 'model', 'ollama-url', 'qdrant-url']),
  apply: new Set(['workspace', 'proposal']),
};
const BOOLEAN = new Set(['dry-run', 'prune']);

function parseOptions(command, args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (!flag.startsWith('--') || !ALLOWED[command].has(flag.slice(2))) {
      throw new Error(`Unsupported ${command} option: ${flag}`);
    }
    const key = flag.slice(2);
    if (options[key] !== undefined) throw new Error(`Repeated option: ${flag}`);
    if (BOOLEAN.has(key)) {
      options[key] = true;
      continue;
    }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    options[key] = value;
  }
  return options;
}

function loadLocalEnv() {
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

function workspaceOf(options) {
  let requested = options.workspace ?? process.env.AGENT_WORKSPACE ?? ROOT;
  if (requested === '~') requested = homedir();
  else if (requested.startsWith('~/')) requested = join(homedir(), requested.slice(2));
  const workspace = realpathSync(resolve(requested));
  if (!statSync(workspace).isDirectory()) throw new Error(`Not a directory: ${workspace}`);
  return workspace;
}

function targetOf(options) {
  const workspace = workspaceOf(options);
  // An explicit external workspace also requires an explicit repository ID: do not
  // accidentally query this project's index when opening another repository.
  const repository = options.repository ?? (options.workspace
    ? (workspace === ROOT ? DEFAULT_REPOSITORY : undefined)
    : (process.env.AGENT_REPOSITORY || (workspace === ROOT ? DEFAULT_REPOSITORY : undefined)));
  if (!repository) throw new Error('External workspaces require --repository <stable-id>');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(repository)) {
    throw new Error('Invalid repository ID (2-128 letters/digits/dot/underscore/hyphen)');
  }
  return { workspace, repository };
}

function portOf(options) {
  const port = Number(options.port ?? process.env.AGENT_API_PORT ?? 8765);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Port must be an integer between 1024 and 65535');
  }
  return port;
}

function tokenOf(create = false) {
  if (existsSync(TOKEN_FILE)) {
    const metadata = lstatSync(TOKEN_FILE);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077)) {
      throw new Error(`Token must be a regular, private (0600) file: ${TOKEN_FILE}`);
    }
    const token = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error(`Invalid token in ${TOKEN_FILE}`);
    return token;
  }
  if (!create) throw new Error(`Token not found: ${TOKEN_FILE}. Run agent:up first.`);
  const dir = dirname(TOKEN_FILE);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (statSync(dir).mode & 0o077) throw new Error(`Token directory must be private (0700): ${dir}`);
  const generated = randomBytes(32).toString('hex');
  // Exclusive creation prevents accidentally overwriting existing credentials.
  writeFileSync(TOKEN_FILE, generated + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return generated;
}

function runCore(script, args) {
  const result = spawnSync(process.execPath, [join(ROOT, 'agent-core', script), ...args], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }
  if (!Object.hasOwn(ALLOWED, command)) throw new Error(`Unknown command: ${command}\n${HELP}`);
  const options = parseOptions(command, args);
  if (options.help) { console.log(HELP); return; }
  loadLocalEnv();

  if (command === 'health') {
    const port = portOf(options);
    const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      headers: { Authorization: `Bearer ${tokenOf(false)}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`Agent API on port ${port} returned HTTP ${response.status}`);
    console.log(JSON.stringify({ port, ...(await response.json()) }, null, 2));
    return;
  }

  if (command === 'up') {
    const { workspace, repository } = targetOf(options);
    const port = portOf(options);
    process.env.AGENT_API_TOKEN = tokenOf(true); // Never log or pass the token in argv.
    process.env.AGENT_WORKSPACE = workspace;
    process.env.AGENT_REPOSITORY = repository;
    process.env.AGENT_API_PORT = String(port);
    console.log(`Starting local agent at http://127.0.0.1:${port}`);
    console.log(`Workspace: ${workspace} | Repository: ${repository}`);
    console.log('Foreground process: press Ctrl+C to stop this API instance.');
    await import('../agent-core/server.mjs');
    return;
  }

  if (command === 'ingest') {
    const { workspace, repository } = targetOf(options);
    const extensions = options.extensions || DEFAULT_EXTENSIONS;
    const argv = ['--workspace', workspace, '--repository', repository, '--extensions', extensions];
    for (const key of ['collection', 'model', 'ollama-url', 'qdrant-url']) {
      if (options[key]) argv.push(`--${key}`, options[key]);
    }
    if (options['dry-run']) argv.push('--dry-run');
    if (options.prune) argv.push('--prune'); // Explicit opt-in only.
    runCore('ingest.mjs', argv);
    return;
  }

  if (command === 'apply') {
    if (!options.proposal || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(options.proposal)) {
      throw new Error('apply requires --proposal <UUID>');
    }
    runCore('cli.mjs', ['apply', '--workspace', workspaceOf(options), '--proposal', options.proposal]);
  }
}

main().catch((error) => {
  console.error(`AGENT OPS ERROR: ${error.message}`);
  process.exitCode = 1;
});

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const MAX_BODY_BYTES = 16 * 1024;
const ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function reply(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function authorized(header, token) {
  const actual = Buffer.from(header || '', 'utf8');
  const expected = Buffer.from(`Bearer ${token}`, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJson(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    const error = new Error('Content-Type must be application/json');
    error.status = 415;
    throw error;
  }
  let bytes = 0;
  const buffers = [];
  for await (const part of req) {
    bytes += part.length;
    // Continue consuming the request but never buffer more than the limit.
    if (bytes <= MAX_BODY_BYTES) buffers.push(part);
  }
  if (bytes > MAX_BODY_BYTES) {
    const error = new Error('Request exceeds 16 KiB');
    error.status = 413;
    throw error;
  }
  try {
    const data = JSON.parse(Buffer.concat(buffers).toString('utf8'));
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    const error = new Error('Expected a JSON object');
    error.status = 400;
    throw error;
  }
}

function nonempty(value, label, limit = 4096) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > limit) {
    const error = new Error(`${label} must be a nonempty string (max ${limit} bytes)`);
    error.status = 400;
    throw error;
  }
  return value;
}

/**
 * Thin, loopback-only HTTP transport for the existing Agent Core.
 * `handlers` are injected to keep transport tests independent of Ollama/Qdrant.
 * NO APPLY endpoint: the human must approve via the existing interactive CLI.
 */
export function createLocalApi({ token, handlers }) {
  if (typeof token !== 'string' || Buffer.byteLength(token, 'utf8') < 32) {
    throw new Error('AGENT_API_TOKEN must have at least 32 random characters');
  }
  for (const name of ['ask', 'review', 'propose', 'preview']) {
    if (typeof handlers?.[name] !== 'function') throw new Error(`Missing handler: ${name}`);
  }
  let busy = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    // Reject browser-originated requests, even on loopback (local CSRF protection).
    if (req.headers.origin) return reply(res, 403, { error: 'Browser origins are not accepted' });
    if (!authorized(req.headers.authorization, token)) return reply(res, 401, { error: 'Unauthorized' });
    if (url.search) return reply(res, 400, { error: 'Query parameters are unsupported' });

    if (url.pathname === '/v1/health' && req.method === 'GET') {
      return reply(res, 200, {
        status: 'ok',
        capabilities: ['ask', 'review', 'edit-propose', 'edit-preview'],
        apply: 'interactive-cli-only',
      });
    }

    const match = /^\/v1\/edits\/([^/]+)$/.exec(url.pathname);
    if (match && req.method === 'GET') {
      if (!ID.test(match[1])) return reply(res, 400, { error: 'Invalid proposal ID' });
      try {
        return reply(res, 200, await handlers.preview(match[1]));
      } catch (error) {
        console.error('[agent-api] preview failed:', error.message);
        return reply(res, 422, { error: 'Proposal unavailable, invalid or stale' });
      }
    }

    const routes = {
      '/v1/ask': 'ask',
      '/v1/review': 'review',
      '/v1/edits/propose': 'propose',
    };
    const handler = routes[url.pathname];
    if (!handler) return reply(res, 404, { error: 'Not found' });
    if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed' });
    if (busy) return reply(res, 429, { error: 'Another model request is running' });

    busy = true;
    try {
      const body = await readJson(req);
      let result;
      if (handler === 'ask') {
        const question = nonempty(body.question, 'question');
        const files = body.files === undefined ? [] : body.files;
        if (!Array.isArray(files) || files.length > 4 || files.some(f => typeof f !== 'string' || !f || f.length > 512)) {
          return reply(res, 400, { error: 'files must contain up to four relative paths' });
        }
        if (body.context !== undefined && !['auto', 'none'].includes(body.context)) {
          return reply(res, 400, { error: 'context must be auto or none' });
        }
        result = await handlers.ask({ question, files, context: body.context || (files.length ? 'none' : 'auto') });
      } else if (handler === 'review') {
        const diff = nonempty(body.diff, 'diff path', 512);
        const question = body.question === undefined ? undefined : nonempty(body.question, 'question');
        result = await handlers.review({ diff, question });
      } else {
        const file = nonempty(body.file, 'file path', 512);
        const instruction = nonempty(body.instruction, 'instruction');
        result = await handlers.propose({ file, instruction });
      }
      return reply(res, 200, result);
    } catch (error) {
      if (error.status) return reply(res, error.status, { error: error.message });
      // Do not leak internal paths, raw model responses or secrets to API clients.
      console.error('[agent-api] operation failed:', error);
      return reply(res, 422, { error: 'Operation failed; inspect the local server log' });
    } finally {
      busy = false;
    }
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  server.maxRequestsPerSocket = 100;
  return server;
}

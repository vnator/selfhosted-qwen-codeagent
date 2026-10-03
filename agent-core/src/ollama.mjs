const DEFAULT_URL = 'http://127.0.0.1:11434';

export function createOllamaClient({
  url = process.env.OLLAMA_URL || DEFAULT_URL,
  model = process.env.AGENT_MODEL || 'qwen2.5-coder:7b',
  context = Number(process.env.AGENT_CONTEXT || 16384),
  transport = fetch,
} = {}) {
  if (!Number.isInteger(context) || context < 1024 || context > 32768) {
    throw new Error('AGENT_CONTEXT must be an integer between 1024 and 32768 for this model profile');
  }
  const endpoint = new URL('/api/chat', url);
  // Local-first by default. Remote Ollama requires a deliberate configuration change.
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) {
    throw new Error('Agent Core currently supports loopback Ollama endpoints only');
  }

  return {
    model,
    async complete({ system, user, temperature = 0.1 }) {
      const response = await transport(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(180_000),
        body: JSON.stringify({
          model,
          stream: false,
          options: { num_ctx: context, temperature },
          // Deliberately NO tools: the current Qwen 7B failed structured tool calling.
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Ollama request failed: HTTP ${response.status}`);
      }
      const payload = await response.json();
      if (payload.error) throw new Error(`Ollama: ${payload.error}`);
      if (payload.done_reason === 'length') throw new Error('Model output was truncated; no action will be proposed');
      const answer = payload.message?.content;
      if (typeof answer !== 'string' || !answer.trim()) throw new Error('Model returned no textual answer');
      return answer;
    },
  };
}

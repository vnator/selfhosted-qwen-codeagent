#!/usr/bin/env bash
# Diagnostic only: supplies a fictitious read_file definition; never executes it.
set -Eeuo pipefail

OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
AGENT_MODEL="${AGENT_MODEL:-qwen2.5-coder:7b}"
AGENT_CONTEXT="${AGENT_CONTEXT:-16384}"
for cmd in curl jq; do
  command -v "$cmd" >/dev/null || { printf 'ERROR: missing command: %s\n' "$cmd" >&2; exit 2; }
done

PAYLOAD="$(jq -n --arg model "$AGENT_MODEL" --argjson ctx "$AGENT_CONTEXT" '{
  model: $model,
  stream: false,
  options: {temperature: 0, num_ctx: $ctx},
  messages: [{role: "user", content: "Call the read_file function to read lua/plugins/minuet.lua. Invoke the provided tool."}],
  tools: [{
    type: "function",
    function: {
      name: "read_file",
      description: "Diagnostic-only fictional function. No file is actually accessed.",
      parameters: {
        type: "object",
        properties: {filepath: {type: "string"}},
        required: ["filepath"]
      }
    }
  }]
}')"
RESPONSE="$(curl --connect-timeout 3 --max-time 180 -fsS "$OLLAMA_URL/api/chat" \
  -H 'Content-Type: application/json' -d "$PAYLOAD")"

jq '{model, message: {content: .message.content, tool_calls: .message.tool_calls}, done_reason}' <<<"$RESPONSE"

if jq -e '
  (.message.tool_calls // [])
  | any(.[];
      .function.name == "read_file"
      and .function.arguments.filepath == "lua/plugins/minuet.lua"
    )
' >/dev/null <<<"$RESPONSE"; then
  printf 'PASS: a structured tool call was returned. The tool was NOT executed.\n'
else
  printf 'FAIL: no valid structured read_file call (text in content is not an action).\n' >&2
  exit 1
fi

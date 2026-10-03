#!/usr/bin/env bash
# Read-only checks against an existing local Ollama endpoint.
set -Eeuo pipefail

OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
SUGGESTION_MODEL="${SUGGESTION_MODEL:-qwen2.5-coder:1.5b-base}"
AGENT_MODEL="${AGENT_MODEL:-qwen2.5-coder:7b}"
for cmd in curl jq; do
  command -v "$cmd" >/dev/null || { printf 'ERROR: missing command: %s\n' "$cmd" >&2; exit 2; }
done

printf 'Checking Ollama at %s\n' "$OLLAMA_URL"
curl --connect-timeout 3 --max-time 10 -fsS "$OLLAMA_URL/api/version" | jq -r '"Ollama version: " + .version'
TAGS="$(curl --connect-timeout 3 --max-time 10 -fsS "$OLLAMA_URL/api/tags")"
for model in "$SUGGESTION_MODEL" "$AGENT_MODEL"; do
  if jq -e --arg name "$model" '.models | any(.[]; .name == $name or .model == $name)' >/dev/null <<<"$TAGS"; then
    printf 'PASS model available: %s\n' "$model"
  else
    printf 'FAIL model missing: %s\n' "$model" >&2
    exit 1
  fi
done
printf 'Installed models:\n'
jq -r '.models[] | "- \(.name) [\((.capabilities // []) | join(", "))]"' <<<"$TAGS"
printf '\nThis script does not assert GPU residency or agent tool support.\n'
printf 'For residency: docker exec agent_ollama ollama ps\n'
printf 'For tool support: ./tests/test-tool-calling.sh\n'

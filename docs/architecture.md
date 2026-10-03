# Architecture and boundaries

> Status: proposed contract, not a declaration that every component is implemented.

## Goal

Build a local-first coding assistant whose capabilities are independently testable and whose execution privileges are explicitly controlled. Neovim is one client, not the agent runtime itself.

```text
                            Developer / Neovim (Grimory)
                              |               |
                   inline suggestions    coding requests
                              |               |
                         Minuet (FIM)    Agent runtime (planned)
                              |          |          |          |
                              |       context     policies    executor
                              |          |          |          |
                              |      retrieval   ASK/EDIT/   validated
                              |        (RAG)      REVIEW     operations
                              |          |
                              |    ingestion --> embeddings --> Qdrant
                              |                       (optional)
                              +----------- Ollama ----------+
```

## Responsibilities

| Component | Owns | Does not own |
| --- | --- | --- |
| Ollama | Model serving, inference and context options | Git mutations, file permissions or tool execution |
| Minuet | Low-latency fill-in-the-middle suggestions | Project-wide actions |
| Agent runtime | Session state, action protocol, tool responses, permissions | Raw inference implementation |
| Ingestion | Filtering, parsing, chunk identity, embeddings, index updates | Permission to edit source code |
| Qdrant | Vector indexing and retrieval | Automatic ingestion or policy decisions |
| Open WebUI | Optional browser UI | Mandatory availability for the Neovim client |

## Existing model profiles (do not download a replacement implicitly)

- Suggestions: `qwen2.5-coder:1.5b-base` (FIM).
- Coding/chat/edit experiments: `qwen2.5-coder:7b`.
- Start agent requests at `num_ctx=16384` and measure GPU memory; model metadata advertised a 32768-token context limit in the owner's Ollama API output.
- Tool calling is currently **not accepted**: the model has returned textual JSON/XML with `message.tool_calls = null` under Ollama 0.33.3. A model advertising `tools` is not a passing integration test.

## First implementation slices

1. Health checks: model availability, GPU observation and structured tool-call regression test.
2. Ingestion: explicit data sources, filtering, reproducible chunks, metadata and incremental upsert/delete.
3. Repository editing: small, isolated test project, textual edit format, reviewable diff, explicit approval and test feedback.
4. Tool-based autonomy only after a structured request/response integration test passes.

## Infrastructure notes

Keep current named volumes when modifying Compose. Prefer loopback port bindings for host-only access; make browser UI and vector database optional when the project's ingestion wiring is known. Do not keep experimental template overrides by default without passing comparison tests. Pin image versions/digests after confirming working combinations.

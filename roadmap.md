# Self-hosted Code Agent — Roadmap

## Current implementation (Node.js, independent from editors)
- [x] ASK with explicit source references
- [x] REVIEW of explicitly supplied diffs
- [x] EDIT proposal and diff; single-file APPLY with typed approval and stale-proposal rejection
- [x] Incremental Node ingestion with deterministic point IDs and line provenance
- [x] Read-only ContextProvider and CLI `ASK --context auto` (live Qdrant test confirmed)
- [x] Source-aware candidate re-ranking and per-file diversity for implementation questions (unit tests)
- [ ] Verify live EDIT-approval query retrieves implementation files without explicit `--file`
- [ ] Independent lexical/symbol candidate retrieval for queries poorly served by embeddings
- [x] Ignore JSON/XML emitted as text; never treat it as a tool call
- [x] File integrity regression coverage (LF, CRLF, UTF-8 BOM, trailing newlines)
- [ ] Retire Python implementation artifacts after validating their Node replacements
- [ ] Controlled discovery/planning and bounded validation loop
- [x] Initial loopback-only authenticated Node API: ASK, REVIEW, EDIT proposal and preview (live health + ASK verified)
- [ ] Live HTTP smoke test: proposal and diff preview on a disposable file; APPLY remains interactive CLI only
- [ ] Cross-editor integration and workspace lifecycle (server currently binds one workspace/repository per process)
- [ ] Grounded citations: claims must be supported by returned source ranges (known live ASK limitation)

## Earlier integration backlog


## adapters
- [x] VSCode Integration
- [ ] cursor
- [ ] claude code
- [ ] Vim Integration
- [ ] Github Integration
- [ ] Gitlab Integration

## Configs
- [ ] Qdrant install and Configs
- [ ] RAG
- [ ] Prompt Compress
- [ ] Guard rails


## Skills
- [ ] Comportamento de ASK
- [ ] Comportamento de Code Review

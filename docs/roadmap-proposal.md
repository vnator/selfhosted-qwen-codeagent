# Roadmap proposal (additive)

Keep the original `roadmap.md` until the active ingestion branch is available. The original public roadmap groups work under **adapters**, **configs** and **skills**. The following milestones add acceptance criteria rather than overwriting those themes.

## Foundation / Configs
- [ ] Preserve Ollama volume, verify both existing Qwen model tags, restrict unnecessary host exposure.
- [ ] Make optional services optional only after mapping the ingestion pipeline's actual dependencies.
- [ ] Run `scripts/check-infra.sh` and store the result with the change.
- [ ] Register the known tool-calling incompatibility with `tests/test-tool-calling.sh`.

## Ingestion / RAG
- [ ] Document sources, exclusion rules, parsing, chunking and model/dimension.
- [ ] Implement manifest-driven incremental upsert and deletion.
- [ ] Attach provenance metadata and repository filters to retrieval.
- [ ] Evaluate ingestion and retrieval using a small known-answer fixture repository.

## Adapters / Coding workflow
- [x] Local Minuet FIM suggestions tested with `qwen2.5-coder:1.5b-base`.
- [ ] Test text-based repository editing with `qwen2.5-coder:7b` in a disposable project.
- [ ] Review diff, approve write, run targeted checks and report results.
- [ ] Integrate the proven editor workflow with Neovim; avoid redundant chat/agent plugins.
- [ ] Consider broader tool-based autonomy only after structured `tool_calls` passes reliably.

## Skills / Guardrails
- [ ] Define ASK / EDIT / REVIEW contracts and approvals.
- [ ] Add workspace limits, validation, audit trail and timeouts.
- [ ] Make prompt compression measurable and preserve cited source context.

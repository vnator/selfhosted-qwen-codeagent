# Ollama / Qwen2.5 Coder tool-calling regression

## Observed in development

With Ollama `0.33.3` and `qwen2.5-coder:7b`, a `/api/chat` request containing one `read_file` function definition returned a textual JSON function call in `message.content`, but `message.tool_calls` was `null`. Testing `OLLAMA_GO_TEMPLATE=0` yielded textual XML rather than a structured call. Loading the model in GPU memory and increasing `num_ctx` did not by themselves establish functioning tool calling.

## Regression test

From a trusted local host with Ollama running:

```bash
./tests/test-tool-calling.sh
```

A pass requires `message.tool_calls` to be a nonempty array with a `read_file` call for `lua/plugins/minuet.lua`. It does **not** execute the tool or access that file. A returned JSON/XML string in `message.content` is a failure.

Do not work around this by automatically executing arbitrary textual output. Keep textual editing with a diff/approval step as a separate capability until the structured protocol works.

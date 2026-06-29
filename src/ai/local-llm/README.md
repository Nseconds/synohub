# Local LLM Prompt Files

This folder controls the Ollama/Qwen Local LLM chat behavior.

- `systemPrompt.txt`: Compact SynoHub operating prompt for the smaller local model.
- `examples.txt`: Local style examples appended to the local prompt. This can be a JSON array of `{ "input", "output" }` examples or plain text.
- `styleExamples.json`: Legacy fallback path for JSON few-shot examples.

Gemini still uses `prompts.json`. Local LLM uses these files plus the same live SynoHub database context and role/security rules from `server.ts`.

Why this exists:
- `prompts.json` is very large and works better with Gemini's larger context.
- Local Qwen models need a shorter, direct, high-priority instruction file.
- `server.ts` appends this local prompt after the shared context so the local model sees it clearly.

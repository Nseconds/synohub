# Local LLM Prompt Files

This folder controls the Ollama/Qwen Local LLM chat behavior.

- `systemPrompt.txt`: Compact SynoHub operating prompt for the smaller local model.
- `examples.txt`: Local style examples appended to the local prompt. This can be a JSON array of `{ "input", "output" }` examples or plain text.
- `styleExamples.json`: Legacy fallback path for JSON few-shot examples.

All chat providers first use the modular prompt files in `src/ai/prompts/`.
`prompts.json` is still loaded as a fallback if modular prompt loading fails.
Local LLM responses also receive the files in this folder as a final style override, plus the same live SynoHub database context and role/security rules from `server.ts`.

Why this exists:
- The modular prompt files keep shared Gemini/local behavior easier to edit than the old all-in-one `prompts.json`.
- `prompts.json` remains useful as a backup/fallback prompt.
- Local Qwen models need a shorter, direct, high-priority instruction file.
- `server.ts` appends this local prompt after the shared context so the local model sees it clearly.

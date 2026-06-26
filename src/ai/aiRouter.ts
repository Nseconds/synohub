export type AiProviderMode = "gemini" | "local" | "gpt-oss" | "cohere" | "compare";

export function normalizeAiProviderMode(value: unknown): AiProviderMode {
  const raw = String(value || "local").toLowerCase();
  if (raw === "nvidia" || raw === "openrouter-primary") return "gpt-oss";
  if (raw === "openrouter" || raw === "extra") return "cohere";
  if (raw === "gemini" || raw === "local" || raw === "gpt-oss" || raw === "cohere" || raw === "compare") {
    return raw;
  }
  return "local";
}

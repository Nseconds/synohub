import type { SafeQueryAiMode } from "./chatService";

export type QueryProviderName = "gemini" | "local" | "nvidia" | "openrouter";
export type PublicAiProviderMode = "gemini" | "local" | "gpt-oss" | "cohere" | "compare";

export function normalizeQueryAiMode(value: unknown): SafeQueryAiMode {
  const raw = String(value || process.env.SAFE_QUERY_AI_MODE || "local").toLowerCase();
  if (raw === "extra" || raw === "gemma" || raw === "cohere") return "openrouter";
  if (raw === "gpt-oss" || raw === "gptoss" || raw === "openrouter-primary") return "nvidia";
  return raw === "gemini" || raw === "compare" || raw === "local" || raw === "nvidia" || raw === "openrouter" ? raw : "local";
}

export function normalizeProviderName(value: unknown): QueryProviderName | null {
  const raw = String(value || "").toLowerCase().trim();
  if (raw === "gemini" || raw === "local" || raw === "nvidia") return raw;
  if (raw === "gpt-oss" || raw === "gptoss" || raw === "openrouter-primary") return "nvidia";
  if (raw === "openrouter" || raw === "extra" || raw === "gemma" || raw === "cohere") return "openrouter";
  return null;
}

export function normalizeCompareProviders(value: unknown): QueryProviderName[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : ["gemini", "local"];
  const providers = rawItems
    .map(normalizeProviderName)
    .filter((provider): provider is QueryProviderName => Boolean(provider));
  const unique = Array.from(new Set(providers)).slice(0, 4);
  return unique.length > 0 ? unique : ["gemini", "local"];
}

export function normalizeAiProviderMode(value: unknown): PublicAiProviderMode {
  const mode = normalizeQueryAiMode(value);
  if (mode === "nvidia") return "gpt-oss";
  if (mode === "openrouter") return "cohere";
  return mode;
}

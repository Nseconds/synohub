import { GoogleGenAI } from "@google/genai";
import env from "../shared/validation/env";
import {
  runOpenRouterChatCompletion as runOpenRouterProviderChatCompletion,
  type OpenRouterChatMessage,
} from "./providers/gptOss";

export function cleanEnvVar(val: string | undefined): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export const rawGeminiKey = cleanEnvVar(env.GEMINI_API_KEY);
export const cleanedGeminiKey = rawGeminiKey?.startsWith("sk-or-") ? null : rawGeminiKey;
export const cleanedOpenRouterKey = cleanEnvVar(env.OPENROUTER_API_KEY || env.NVIDIA_API_KEY) || (rawGeminiKey?.startsWith("sk-or-") ? rawGeminiKey : null);
export const openRouterBaseUrl = cleanEnvVar(env.OPENROUTER_BASE_URL) || "https://openrouter.ai/api/v1";
export const openRouterModel = cleanEnvVar(env.OPENROUTER_MODEL || env.NVIDIA_MODEL) || "openai/gpt-oss-120b:free";
export const extraLlmModel = cleanEnvVar(env.OPENROUTER_COMPARE_MODEL || env.EXTRA_LLM_MODEL) || "cohere/north-mini-code:free";
export const extraLlmReasoning = String(env.OPENROUTER_COMPARE_REASONING || env.EXTRA_LLM_REASONING || "true").toLowerCase() !== "false";
export const geminiModel = cleanEnvVar(env.GEMINI_MODEL) || "gemini-3.5-flash";
export const openRouterPrimaryLabel = "GPT OSS 120B";
export const cloudProviderLabel = cleanedGeminiKey ? "Gemini" : openRouterPrimaryLabel;

console.log("--- Environment Variable Sync Check ---");
console.log("OLLAMA_URL:", env.OLLAMA_URL);
console.log("OLLAMA_MODEL:", env.OLLAMA_MODEL);
console.log("OLLAMA_NUM_THREAD:", env.OLLAMA_NUM_THREAD);
console.log("OLLAMA_NUM_GPU:", env.OLLAMA_NUM_GPU);
console.log("GEMINI_API_KEY:", cleanedGeminiKey ? "PRESENT" : "MISSING");
console.log("GEMINI_MODEL:", geminiModel);
console.log("OPENROUTER_API_KEY:", cleanedOpenRouterKey ? "PRESENT" : "MISSING");
console.log("OPENROUTER_MODEL:", openRouterModel);
console.log("OPENROUTER_COMPARE_MODEL:", extraLlmModel);
console.log("---------------------------------------");

export let genAI: any = null;
if (cleanedGeminiKey) {
  genAI = new GoogleGenAI({
    apiKey: cleanedGeminiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

export async function runOpenRouterChatCompletion(args: {
  messages: OpenRouterChatMessage[];
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  reasoning?: boolean;
  reasoningStateKey?: string;
}): Promise<string> {
  return runOpenRouterProviderChatCompletion({
    ...args,
    apiKey: cleanedOpenRouterKey,
    baseUrl: openRouterBaseUrl,
    defaultModel: openRouterModel,
  });
}

import { z } from "zod";

const optionalEnvString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}, z.string().optional());

export const EnvSchema = z.object({
  AUTH_SECRET: optionalEnvString,
  GEMINI_API_KEY: optionalEnvString.default(""),
  GEMINI_MODEL: optionalEnvString.default("gemini-3.5-flash"),
  JWT_SECRET: optionalEnvString,
  NVIDIA_API_KEY: optionalEnvString,
  NVIDIA_MODEL: optionalEnvString,
  OLLAMA_KEEP_ALIVE: optionalEnvString.default("5m"),
  OLLAMA_MODEL: optionalEnvString.default("qwen2.5:1.5b"),
  OLLAMA_NUM_CTX: optionalEnvString.default("4096"),
  OLLAMA_NUM_GPU: optionalEnvString.default("-1"),
  OLLAMA_NUM_THREAD: optionalEnvString.default("6"),
  OLLAMA_URL: optionalEnvString.default("http://localhost:11434"),
  OPENROUTER_API_KEY: optionalEnvString.default(""),
  OPENROUTER_APP_NAME: optionalEnvString.default("SynoHub"),
  OPENROUTER_BASE_URL: optionalEnvString.default("https://openrouter.ai/api/v1"),
  OPENROUTER_COMPARE_MODEL: optionalEnvString,
  OPENROUTER_COMPARE_REASONING: optionalEnvString.default("true"),
  OPENROUTER_MODEL: optionalEnvString.default("openai/gpt-oss-120b:free"),
  OPENROUTER_SITE_URL: optionalEnvString.default("http://localhost:3000"),
  EXTRA_LLM_MODEL: optionalEnvString,
  EXTRA_LLM_REASONING: optionalEnvString,
  PORT: z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return 3000;
    return value;
  }, z.coerce.number().int().positive().default(3000)),
}).passthrough();

const env = EnvSchema.parse(process.env);

export default env;

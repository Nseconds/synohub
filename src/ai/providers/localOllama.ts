import axios from "axios";
import env from "../../shared/validation/env";

export async function runLocalOllamaChatCompletion(args: {
  localSystemInstruction: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  fallback?: boolean;
}): Promise<string> {
  let ollamaUrl = env.OLLAMA_URL;
  if (!ollamaUrl.endsWith("/api/chat")) {
    ollamaUrl = ollamaUrl.replace(/\/$/, "") + "/api/chat";
  }

  const ollamaOptions: any = {
    num_ctx: Math.max(parseInt(env.OLLAMA_NUM_CTX, 10), 4096),
    num_thread: parseInt(env.OLLAMA_NUM_THREAD, 10),
  };

  const gpuConfig = parseInt(env.OLLAMA_NUM_GPU, 10);
  ollamaOptions.num_gpu = gpuConfig;

  if (gpuConfig !== -1) {
    ollamaOptions.main_gpu = 0;
  }

  const currentOllamaModel = env.OLLAMA_MODEL;

  const requestBody = {
    model: currentOllamaModel,
    messages: [
      { role: "system", content: args.localSystemInstruction },
      ...args.history,
      { role: "user", content: args.message },
    ],
    options: ollamaOptions,
    keep_alive: env.OLLAMA_KEEP_ALIVE,
    stream: false,
  };

  if (!args.fallback) {
    console.log(`[AI Chat] Mode=local, using Ollama/local LLM: model=${requestBody.model}, options=${JSON.stringify(ollamaOptions)}`);
  } else {
    console.log(`[AI Chat] START Ollama fallback: model=${requestBody.model}, options=${JSON.stringify(ollamaOptions)}`);
  }

  const response = await axios.post(ollamaUrl, requestBody, {
    timeout: 300000,
    validateStatus: () => true,
  });

  if (response.status !== 200) {
    throw new Error(`Ollama returned status ${response.status}`);
  }

  return response.data.message.content;
}

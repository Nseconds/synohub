import axios from "axios";

export async function runLocalOllamaChatCompletion(args: {
  localSystemInstruction: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  fallback?: boolean;
}): Promise<string> {
  let ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  if (!ollamaUrl.endsWith("/api/chat")) {
    ollamaUrl = ollamaUrl.replace(/\/$/, "") + "/api/chat";
  }

  const ollamaOptions: any = {
    num_ctx: Math.max(parseInt(process.env.OLLAMA_NUM_CTX || "4096"), 4096),
    num_thread: parseInt(process.env.OLLAMA_NUM_THREAD || "6"),
  };

  const gpuConfig = parseInt(process.env.OLLAMA_NUM_GPU || "-1");
  ollamaOptions.num_gpu = gpuConfig;

  if (gpuConfig !== -1) {
    ollamaOptions.main_gpu = 0;
  }

  const currentOllamaModel = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";

  const requestBody = {
    model: currentOllamaModel,
    messages: [
      { role: "system", content: args.localSystemInstruction },
      ...args.history,
      { role: "user", content: args.message },
    ],
    options: ollamaOptions,
    keep_alive: process.env.OLLAMA_KEEP_ALIVE || "5m",
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

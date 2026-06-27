import axios from "axios";
import env from "../../shared/validation/env";

export interface OpenRouterChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  reasoning_details?: unknown;
}

const openRouterReasoningMessages = new Map<string, Array<OpenRouterChatMessage>>();

export async function runOpenRouterChatCompletion(args: {
  messages: OpenRouterChatMessage[];
  apiKey: string | null | undefined;
  baseUrl: string;
  defaultModel: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  reasoning?: boolean;
  reasoningStateKey?: string;
}): Promise<string> {
  if (!args.apiKey) {
    throw new Error("OpenRouter provider is not configured on this server.");
  }

  const requestMessages = args.reasoning && args.reasoningStateKey
    ? [
        ...args.messages.filter(message => message.role === "system"),
        ...(openRouterReasoningMessages.get(args.reasoningStateKey) || []),
        ...args.messages.filter(message => message.role !== "system").slice(-1),
      ]
    : args.messages;

  const response = await axios.post(`${args.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    model: args.model || args.defaultModel,
    messages: requestMessages,
    temperature: args.temperature ?? 0.2,
    max_tokens: args.maxTokens ?? 1200,
    stream: false,
    ...(args.reasoning ? { reasoning: { enabled: true } } : {}),
    ...(args.json ? { response_format: { type: "json_object" } } : {}),
  }, {
    timeout: 300000,
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.OPENROUTER_SITE_URL,
      "X-Title": env.OPENROUTER_APP_NAME,
    },
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    const message = response.data?.error?.message || response.data?.message || JSON.stringify(response.data);
    throw new Error(`OpenRouter returned status ${response.status}: ${message}`);
  }

  const assistantMessage = response.data?.choices?.[0]?.message;
  const content = assistantMessage?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenRouter returned no text content.");
  }

  if (args.reasoning && args.reasoningStateKey) {
    const prior = openRouterReasoningMessages.get(args.reasoningStateKey) || [];
    const latestUser = requestMessages.filter(message => message.role === "user").slice(-1);
    const nextMessages = [
      ...prior,
      ...latestUser,
      {
        role: "assistant" as const,
        content,
        reasoning_details: assistantMessage?.reasoning_details,
      },
    ].filter(message => message.content).slice(-8);
    openRouterReasoningMessages.set(args.reasoningStateKey, nextMessages);
  }

  return content;
}

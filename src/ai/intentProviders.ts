import path from "path";
import { execFile } from "child_process";
import { staffRoster } from "../auth/users";
import { buildIntentDetectorSystemPrompt } from "./intentService";
import {
  detectQueryIntent,
  parseProviderIntent,
  providerToDetected,
  type DetectedQueryIntent,
  type QueryProviderResult,
} from "./queryIntentDetector";
import type { QueryProviderName } from "./aiRouter";
import {
  cleanedGeminiKey,
  cloudProviderLabel,
  extraLlmModel,
  extraLlmReasoning,
  geminiModel,
  genAI,
  openRouterModel,
  openRouterPrimaryLabel,
  runOpenRouterChatCompletion,
} from "./providerConfig";
import { cleanVisibleAssistantText } from "./responseFormatter";
import { paramsMatch, safeQueryHandlers } from "./safeQueryExecutor";

export function getProviderLabel(provider: QueryProviderName): string {
  if (provider === "gemini") return "Gemini";
  if (provider === "local") return "Local LLM";
  if (provider === "nvidia") return openRouterPrimaryLabel;
  return "Cohere";
}

function isOpenRouterPolicyEndpointError(error: string): boolean {
  return /No endpoints available matching your guardrail restrictions and data policy|settings\/privacy|status 404/i.test(String(error || ""));
}

export function isOpenRouterTemporaryAvailabilityError(error: string): boolean {
  return /status 429|Provider returned error|rate.?limit|thrott/i.test(String(error || ""));
}

export function formatProviderError(provider: QueryProviderName, error: string): string {
  const raw = String(error || "");
  if (provider === "nvidia" && isOpenRouterPolicyEndpointError(raw)) {
    return [
      `${openRouterPrimaryLabel} is unavailable for the current OpenRouter model/account policy.`,
      `Configured model: ${openRouterModel}`,
      "OpenRouter did not provide a chat endpoint allowed by your privacy/data policy.",
      "Use Gemini, Local LLM, or Cohere, or change OpenRouter privacy settings/model.",
    ].join("\n");
  }
  if (provider === "nvidia" && isOpenRouterTemporaryAvailabilityError(raw)) {
    return [
      `${openRouterPrimaryLabel} is currently throttled or temporarily unavailable through OpenRouter.`,
      `Configured model: ${openRouterModel}`,
      `Use Gemini, Local LLM, or Cohere for now, or try ${openRouterPrimaryLabel} again later.`,
    ].join("\n");
  }
  return cleanVisibleAssistantText(raw);
}

export async function runLocalIntentProvider(message: string): Promise<QueryProviderResult> {
  const startTime = Date.now();
  const detectorPath = path.join(process.cwd(), "src", "ai", "intentDetector.py");
  console.log("[Safe Query] Mode=local, using Python/local intent detector.");

  const deterministic = detectQueryIntent(message);
  if (deterministic && deterministic.confidence >= 0.9) {
    return {
      ...deterministic,
      durationMs: Date.now() - startTime,
    };
  }

  return new Promise((resolve) => {
    execFile("python3", [detectorPath, message], { timeout: 5000, maxBuffer: 1024 * 64 }, (error, stdout) => {
      const durationMs = Date.now() - startTime;
      if (error || !stdout) {
        resolve({
          durationMs,
          error: error?.message || "Local intent detector returned no output.",
        });
        return;
      }

      try {
        const detected = parseProviderIntent(stdout.trim(), safeQueryHandlers);
        resolve({ ...detected, durationMs });
      } catch (parseError) {
        if (deterministic) {
          resolve({ ...deterministic, durationMs });
          return;
        }
        resolve({
          durationMs,
          error: (parseError as Error).message,
        });
      }
    });
  });
}

export async function runGeminiIntentProvider(message: string): Promise<QueryProviderResult> {
  const startTime = Date.now();
  console.log(`[Safe Query] Mode=gemini, using ${cloudProviderLabel} intent detector: model=${cleanedGeminiKey ? geminiModel : openRouterModel}.`);

  try {
    const allowedIntents = Object.keys(safeQueryHandlers).join(", ");
    const detectorSystemInstruction = buildIntentDetectorSystemPrompt({
      kind: "gemini",
      allowedIntents,
      staffNames: staffRoster,
    });

    let raw = "";
    if (genAI && cleanedGeminiKey) {
      const response = await genAI.models.generateContent({
        model: geminiModel,
        contents: `User question: ${message}`,
        config: {
          systemInstruction: detectorSystemInstruction,
          responseMimeType: "application/json",
        },
      });
      raw = response.text;
    } else {
      raw = await runOpenRouterChatCompletion({
        json: true,
        maxTokens: 500,
        temperature: 0,
        messages: [
          { role: "system", content: detectorSystemInstruction },
          { role: "user", content: `User question: ${message}` },
        ],
      });
    }

    const detected = parseProviderIntent(raw || "", safeQueryHandlers);
    const deterministic = detectQueryIntent(message);
    if (
      deterministic &&
      ["getTicketsByStaff", "getPendingTicketsByStaff"].includes(deterministic.intent) &&
      ["findCustomerByName", "getCustomerHistory", "getCustomerFleetSize", "getCustomerRegion"].includes(detected.intent)
    ) {
      return {
        ...deterministic,
        confidence: Math.max(deterministic.confidence, detected.confidence),
        durationMs: Date.now() - startTime,
      };
    }

    if (deterministic?.intent === "getTicketsByServiceType" && detected.intent !== "getTicketsByServiceType") {
      return {
        ...deterministic,
        confidence: Math.max(deterministic.confidence, 0.94),
        durationMs: Date.now() - startTime,
      };
    }

    if (deterministic && deterministic.confidence >= 0.9) {
      const sameIntentDifferentParams = deterministic.intent === detected.intent && !paramsMatch(deterministic.intent, deterministic.params, detected.params);
      const highConfidenceDisagreement = deterministic.intent !== detected.intent;
      if (sameIntentDifferentParams || highConfidenceDisagreement) {
        return {
          ...deterministic,
          confidence: Math.max(deterministic.confidence, detected.confidence),
          durationMs: Date.now() - startTime,
        };
      }
    }

    return {
      ...detected,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      durationMs: Date.now() - startTime,
      error: (error as Error).message,
    };
  }
}

export async function runOpenRouterIntentProvider(message: string): Promise<QueryProviderResult> {
  const startTime = Date.now();
  console.log(`[Safe Query] Mode=openrouter, using OpenRouter intent detector: model=${extraLlmModel}.`);

  try {
    const deterministic = detectQueryIntent(message);
    if (deterministic && deterministic.confidence >= 0.9) {
      return {
        ...deterministic,
        durationMs: Date.now() - startTime,
      };
    }

    const allowedIntents = Object.keys(safeQueryHandlers).join(", ");
    const detectorSystemInstruction = buildIntentDetectorSystemPrompt({
      kind: "openrouter",
      allowedIntents,
      staffNames: staffRoster,
    });
    const raw = await runOpenRouterChatCompletion({
      model: extraLlmModel,
      reasoning: extraLlmReasoning,
      json: true,
      maxTokens: 500,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: detectorSystemInstruction,
        },
        { role: "user", content: `User question: ${message}` },
      ],
    });

    const detected = parseProviderIntent(raw || "", safeQueryHandlers);
    return {
      ...detected,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      durationMs: Date.now() - startTime,
      error: (error as Error).message,
    };
  }
}

export async function runNvidiaIntentProvider(message: string): Promise<QueryProviderResult> {
  const startTime = Date.now();
  console.log(`[Safe Query] Mode=nvidia, using ${openRouterPrimaryLabel}/OpenRouter intent detector: model=${openRouterModel}.`);

  try {
    const deterministic = detectQueryIntent(message);
    if (deterministic && deterministic.confidence >= 0.9) {
      return {
        ...deterministic,
        durationMs: Date.now() - startTime,
      };
    }

    const allowedIntents = Object.keys(safeQueryHandlers).join(", ");
    const detectorSystemInstruction = buildIntentDetectorSystemPrompt({
      kind: "nvidia",
      allowedIntents,
      staffNames: staffRoster,
    });
    const raw = await runOpenRouterChatCompletion({
      model: openRouterModel,
      reasoning: true,
      json: true,
      maxTokens: 500,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: detectorSystemInstruction,
        },
        { role: "user", content: `User question: ${message}` },
      ],
    });

    const detected = parseProviderIntent(raw || "", safeQueryHandlers);
    return {
      ...detected,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      durationMs: Date.now() - startTime,
      error: (error as Error).message,
    };
  }
}

export function runIntentDetectorFallback(message: string): Promise<DetectedQueryIntent | null> {
  return runLocalIntentProvider(message).then(providerToDetected);
}

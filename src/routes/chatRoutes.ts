import "dotenv/config";
import express from "express";
import { createServer as createHttpServer } from "http";
import path from "path";
import { createServer as createViteServer } from "vite";
import { db } from "../db";
import { initDB } from "../db/init";
import { customers, serviceRequests, messages } from "../db/schema";
import { eq, like, or, desc, and } from "drizzle-orm";
import axios from "axios";
import crypto from "crypto";
import { execFile } from "child_process";
import fs from "fs";

import { GoogleGenAI } from "@google/genai";
import queryRegistry, { applyRoleScope } from "../ai/queryRegistry";
import { getAuthUser, requireAuth, requireRoles } from "../auth/middleware";
import { issueToken } from "../auth/jwt";
import { allowedStaff, normalizeUserName, staffRoster, type AuthUser, type UserRole } from "../auth/users";
import { chatHistoryPredicates, resolveChatIdentity } from "../auth/permissions";
import { saveLocalSalesplusEntry } from "../services/salesplusService";
import {
  createLeadRegistration,
  createServiceTicket,
  deleteLeadRegistration,
  deleteServiceTicket,
  saveForcedServiceRequestFields,
  updateLeadRegistration,
  updateServiceTicket,
  type ForcedServiceRequestResult,
} from "../services/serviceRequestService";
import { syncRegistrationCustomer } from "../services/customerService";
import { getDashboardData } from "../services/dashboardService";
import { getChatMessagesByPredicate, getRecentChatMessages, saveChatMessage } from "../services/messageService";
import {
  runOpenRouterChatCompletion as runOpenRouterProviderChatCompletion,
  type OpenRouterChatMessage,
} from "../ai/providers/gptOss";
import { runGeminiChatCompletion } from "../ai/providers/gemini";
import { runLocalOllamaChatCompletion } from "../ai/providers/localOllama";
import { buildChatSystemInstruction } from "../ai/prompts/buildPrompt";
import { buildLocalLlmSystemInstruction, loadPrompts } from "../ai/prompts/promptLoader";
import { extractRecordTriggerJson, findRecordTrigger, removeRecordTrigger } from "../ai/saveRecordParser";
import {
  formatServiceTemplateDraft,
  parseForcedServiceRequest,
  parseServiceTemplateRecord,
} from "../ai/serviceTemplateParser";
import {
  normalizeCompareProviders,
  normalizeQueryAiMode,
  type QueryProviderName,
} from "../ai/aiRouter";
import {
  actionIntents,
  detectQueryIntent,
  extractEmail,
  extractPhone,
  extractRegionName,
  normalizeQueryText,
  parseProviderIntent,
  providerToDetected,
  validateQueryIntent,
  validateQueryParams,
  type DetectedQueryIntent,
  type QueryProviderResult,
  type SafeQueryIntent,
} from "../ai/queryIntentDetector";
import { formatActionIntentAnswer } from "../ai/queryResponseFormatter";
import {
  formatIssueSummary,
  formatOperationalAnswer,
  formatOperationalGreeting,
  formatQueueReport,
  formatRegionTicketReport,
  formatServiceTypeReport,
  formatStaffWorkloadReport,
  formatStatusLabelReport,
  formatTicketListReport,
  formatTicketLookup,
  formatTopCustomers,
  getRowAssignee,
  getRowDescription,
  humanDateRangeLabel,
  isSimpleGreetingMessage,
  summarizeRow,
} from "../ai/queryReportFormatter";
import {
  applyStaffRequestedPersonDefault,
  cleanLocalChatReply,
  cleanVisibleAssistantText,
  formatCompareChatReply,
  getModeScopedChatChannel,
  sanitizeProviderChatHistory,
} from "../ai/responseFormatter";
import {
  type SafeQueryAiMode,
} from "../ai/chatService";

// Helper to safely strip surrounding quotation marks from environment variables
function cleanEnvVar(val: string | undefined): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

const rawGeminiKey = cleanEnvVar(process.env.GEMINI_API_KEY);
const cleanedGeminiKey = rawGeminiKey?.startsWith("sk-or-") ? null : rawGeminiKey;
const cleanedOpenRouterKey = cleanEnvVar(process.env.OPENROUTER_API_KEY || process.env.NVIDIA_API_KEY) || (rawGeminiKey?.startsWith("sk-or-") ? rawGeminiKey : null);
const openRouterBaseUrl = cleanEnvVar(process.env.OPENROUTER_BASE_URL) || "https://openrouter.ai/api/v1";
const openRouterModel = cleanEnvVar(process.env.OPENROUTER_MODEL || process.env.NVIDIA_MODEL) || "openai/gpt-oss-120b:free";
const extraLlmModel = cleanEnvVar(process.env.OPENROUTER_COMPARE_MODEL || process.env.EXTRA_LLM_MODEL) || "cohere/north-mini-code:free";
const extraLlmReasoning = String(process.env.OPENROUTER_COMPARE_REASONING || process.env.EXTRA_LLM_REASONING || "true").toLowerCase() !== "false";
const geminiModel = cleanEnvVar(process.env.GEMINI_MODEL) || "gemini-3.5-flash";
const openRouterPrimaryLabel = "GPT OSS 120B";
const cloudProviderLabel = cleanedGeminiKey ? "Gemini" : openRouterPrimaryLabel;
console.log("--- Environment Variable Sync Check ---");
console.log("OLLAMA_URL:", process.env.OLLAMA_URL);
console.log("OLLAMA_MODEL:", process.env.OLLAMA_MODEL);
console.log("OLLAMA_NUM_THREAD:", process.env.OLLAMA_NUM_THREAD);
console.log("OLLAMA_NUM_GPU:", process.env.OLLAMA_NUM_GPU);
console.log("GEMINI_API_KEY:", cleanedGeminiKey ? "PRESENT" : "MISSING");
console.log("GEMINI_MODEL:", geminiModel);
console.log("OPENROUTER_API_KEY:", cleanedOpenRouterKey ? "PRESENT" : "MISSING");
console.log("OPENROUTER_MODEL:", openRouterModel);
console.log("OPENROUTER_COMPARE_MODEL:", extraLlmModel);
console.log("---------------------------------------");

// Initialize Gemini if key exists
let genAI: any = null;
if (cleanedGeminiKey) {
  genAI = new GoogleGenAI({
    apiKey: cleanedGeminiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// Load prompts
let prompts = loadPrompts();
console.log("Prompts loaded from prompts.json");

function isGenericTicketCreationPrompt(input: string): boolean {
  const normalized = input.toLowerCase().replace(/\s+/g, " ").trim();
  if (!/\b(create|prepare|raise|open|make|add)\b/.test(normalized)) return false;
  if (!/\b(ticket|service request|service ticket)\b/.test(normalized)) return false;
  if (/\bSERVICE REQUEST\b/i.test(input)) return false;

  const hasConcreteDetails =
    extractPhone(input) ||
    extractEmail(input) ||
    extractRegionName(input) ||
    /\b(customer|company|client)\s+[:\w]/i.test(input) ||
    /\bfor\s+[A-Z0-9][A-Z0-9 .&-]{2,}\b/.test(input);

  return !hasConcreteDetails;
}

function formatGenericTicketCreationPrompt(userRole: string, userName: string): string {
  const lines = [
    "Sure. Please share these details so I can prepare the ticket correctly:",
    "",
    "- Customer Name:",
    "- Contact Person:",
    "- Contact Number:",
    "- Service Type:",
    "- Quantity:",
    "- Description:",
    "- Service Location:",
  ];

  if (userRole === "staff" && userName) {
    return lines.join("\n");
  } else {
    lines.push("- Requested Person:");
  }

  return lines.join("\n");
}

const configuredAdminPassword = cleanEnvVar(process.env.ADMIN_PASSWORD) || "admin";
const configuredStaffPassword = cleanEnvVar(process.env.STAFF_PASSWORD) || "staff123";
const devAdminPassword = null;

function cleanRecordDescription(value: unknown): string {
  return String(value || "No description")
    .replace(/\s+/g, " ")
    .trim();
}

function formatStaffRecordList(title: string, rows: any[]): string {
  return `${title}\n\n${rows.map((r: any, index: number) => {
    const status = r.jobStatus || r.status || "Pending";
    const description = cleanRecordDescription(r.issueDescription || r.comment || r.implementationType || "No description");
    const location = r.location || r.region || "";
    const descriptionLabel = /issue|fault|offline|not working|battery|ignition|no connection/i.test(description) ? "Issue" : "Task";
    const plateMatch = description.match(/\bPlate:\s*(.+)$/i);
    const mainDescription = plateMatch ? description.replace(/\s*\bPlate:\s*.+$/i, "").trim() : description;
    const plateLine = plateMatch ? `\n   - Plate: ${plateMatch[1].trim()}` : "";
    const detailLines = `   - ${descriptionLabel}: ${mainDescription}${plateLine}`;
    return `${index + 1}. #${r.id} | ${r.customerName || "Unknown customer"}\n   - Status: ${status}\n${detailLines}${location ? `\n   - Location: ${location}` : ""}`;
  }).join("\n\n")}`;
}

async function classifyActionIntentOnly(): Promise<any[]> {
  return [];
}

const safeQueryHandlers: Record<SafeQueryIntent, (params: any) => Promise<any[]>> = {
  assignTicket: classifyActionIntentOnly,
  reassignTicket: classifyActionIntentOnly,
  updateTicketStatus: classifyActionIntentOnly,
  deleteTicket: classifyActionIntentOnly,
  cancelTicket: classifyActionIntentOnly,
  createLead: classifyActionIntentOnly,
  createServiceRequest: classifyActionIntentOnly,
  createMigrationTicket: classifyActionIntentOnly,
  createInstallationTicket: classifyActionIntentOnly,
  findCustomerByName: queryRegistry.findCustomerByName,
  findCustomerByPhone: queryRegistry.findCustomerByPhone,
  findCustomerByEmail: queryRegistry.findCustomerByEmail,
  getPendingTicketsByStaff: queryRegistry.getPendingTicketsByStaff,
  getOpenTicketsByRegion: queryRegistry.getOpenTicketsByRegion,
  getTicketsByStaff: queryRegistry.getTicketsByStaff,
  getTicketsByRegion: queryRegistry.getTicketsByRegion,
  getTicketsByServiceType: queryRegistry.getTicketsByServiceType,
  getPendingTickets: queryRegistry.getPendingTickets,
  getOpenTickets: queryRegistry.getOpenTickets,
  getCompletedTickets: queryRegistry.getCompletedTickets,
  getTicketById: queryRegistry.getTicketById,
  getTicketsByStatusLabel: queryRegistry.getTicketsByStatusLabel,
  getCompletedTicketsThisWeek: queryRegistry.getCompletedTicketsThisWeek,
  getTicketsNeedingAttention: queryRegistry.getTicketsNeedingAttention,
  getTicketsByCustomer: queryRegistry.getTicketsByCustomer,
  getOpenTicketsByCustomer: queryRegistry.getOpenTicketsByCustomer,
  getTicketsByIssue: queryRegistry.getTicketsByIssue,
  getUnassignedTickets: queryRegistry.getUnassignedTickets,
  getMostCommonIssues: queryRegistry.getMostCommonIssues,
  getCustomerWithMostRequests: queryRegistry.getCustomerWithMostRequests,
  getCustomerHistory: queryRegistry.getCustomerHistory,
  getCustomerFleetSize: queryRegistry.getCustomerFleetSize,
  getCustomerRegion: queryRegistry.getCustomerRegion,
  getTechnicianWorkload: queryRegistry.getTechnicianWorkload,
  getHighestWorkload: queryRegistry.getHighestWorkload,
  getLowestWorkload: queryRegistry.getLowestWorkload,
  getStaffPerformance: queryRegistry.getStaffPerformance,
  getDuplicateRequests: queryRegistry.getDuplicateRequests,
  getLatestRequests: queryRegistry.getLatestRequests,
  getDashboardSummary: queryRegistry.getDashboardSummary,
  getRegionSummary: queryRegistry.getRegionSummary,
  getStatusSummary: queryRegistry.getStatusSummary,
  getDailySummary: queryRegistry.getDailySummary,
  getMonthlySummary: queryRegistry.getMonthlySummary,
  getStaffChatHistory: queryRegistry.getStaffChatHistory,
  getGuestChatHistory: queryRegistry.getGuestChatHistory,
};

function getProviderLabel(provider: QueryProviderName): string {
  if (provider === "gemini") return "Gemini";
  if (provider === "local") return "Local LLM";
  if (provider === "nvidia") return openRouterPrimaryLabel;
  return "Cohere";
}

function isOpenRouterPolicyEndpointError(error: string): boolean {
  return /No endpoints available matching your guardrail restrictions and data policy|settings\/privacy|status 404/i.test(String(error || ""));
}

function isOpenRouterTemporaryAvailabilityError(error: string): boolean {
  return /status 429|Provider returned error|rate.?limit|thrott/i.test(String(error || ""));
}

function formatProviderError(provider: QueryProviderName, error: string): string {
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

async function runOpenRouterChatCompletion(args: {
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

async function runLocalIntentProvider(message: string): Promise<QueryProviderResult> {
  const startTime = Date.now();
  const detectorPath = path.join(process.cwd(), "ai", "intentDetector.py");
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

async function runGeminiIntentProvider(message: string): Promise<QueryProviderResult> {
  const startTime = Date.now();
  console.log(`[Safe Query] Mode=gemini, using ${cloudProviderLabel} intent detector: model=${cleanedGeminiKey ? geminiModel : openRouterModel}.`);

  try {
    const allowedIntents = Object.keys(safeQueryHandlers).join(", ");
    const detectorSystemInstruction = [
          "You are SynoHub's safe intent detector.",
          "Return JSON only with keys: intent, params, confidence.",
          "Never generate SQL, never mention database access, never invent records.",
          "Only choose one of these whitelisted intents:",
          allowedIntents,
          "Use params only for extracted safe values such as ticketId, status, staffName, fromStaffName, region, customerName, value, serviceType, channelName, and limit.",
          "For write/action commands, only classify the action intent and extracted params. Never claim the action was executed.",
          `Known staff names: ${staffRoster.join(", ")}.`,
          "Critical staff rule: if a user asks for records, tickets, requests, leads, jobs, tasks, workload, pending, open, latest, or how many work items for a known staff name, treat the name as staffName, never as customerName or value.",
          "Critical service type rule: migration, migrations, and migrate questions should use getTicketsByServiceType with serviceType migration.",
          "Examples:",
          "records of Athul pls -> {\"intent\":\"getTicketsByStaff\",\"params\":{\"staffName\":\"Athul\",\"limit\":25},\"confidence\":0.95}",
          "Athul records please -> {\"intent\":\"getTicketsByStaff\",\"params\":{\"staffName\":\"Athul\",\"limit\":25},\"confidence\":0.95}",
          "How many jobs does Shamnad have? -> {\"intent\":\"getTicketsByStaff\",\"params\":{\"staffName\":\"Shamnad\",\"limit\":25},\"confidence\":0.95}",
          "how many migrations are ther -> {\"intent\":\"getTicketsByServiceType\",\"params\":{\"serviceType\":\"migration\",\"limit\":50},\"confidence\":0.94}",
          "Find ticket number 7 -> {\"intent\":\"getTicketById\",\"params\":{\"ticketId\":7},\"confidence\":0.97}",
          "What tickets need attention? -> {\"intent\":\"getTicketsNeedingAttention\",\"params\":{\"limit\":50},\"confidence\":0.93}",
          "i want to know my pending list -> {\"intent\":\"getPendingTickets\",\"params\":{\"limit\":50},\"confidence\":0.93}",
          "Show all completed tickets this week -> {\"intent\":\"getCompletedTicketsThisWeek\",\"params\":{\"limit\":50},\"confidence\":0.94}",
          "Show all New Lead tickets -> {\"intent\":\"getTicketsByStatusLabel\",\"params\":{\"statusLabel\":\"new lead\",\"limit\":50},\"confidence\":0.94}",
          "Show today's jobs for all technicians -> {\"intent\":\"getOpenTickets\",\"params\":{\"limit\":50},\"confidence\":0.91}",
          "Show latest service requests in Dubai -> {\"intent\":\"getTicketsByRegion\",\"params\":{\"region\":\"Dubai\",\"limit\":10,\"latest\":true},\"confidence\":0.92}",
          "How many tickets in Sharjah? -> {\"intent\":\"getTicketsByRegion\",\"params\":{\"region\":\"Sharjah\",\"limit\":10,\"countOnly\":true},\"confidence\":0.92}",
          "pending records of Naseeb -> {\"intent\":\"getPendingTicketsByStaff\",\"params\":{\"staffName\":\"Naseeb\",\"limit\":25},\"confidence\":0.96}",
          "tickets for Celine -> {\"intent\":\"getTicketsByStaff\",\"params\":{\"staffName\":\"Celine\",\"limit\":25},\"confidence\":0.95}",
          "Update ticket 5 to Completed -> {\"intent\":\"updateTicketStatus\",\"params\":{\"ticketId\":5,\"status\":\"Completed\"},\"confidence\":0.94}",
          "Assign ticket 12 to Athul -> {\"intent\":\"assignTicket\",\"params\":{\"ticketId\":12,\"staffName\":\"Athul\"},\"confidence\":0.94}",
          "Reassign ticket 3 from Faizal to Nishad -> {\"intent\":\"reassignTicket\",\"params\":{\"ticketId\":3,\"fromStaffName\":\"Faizal\",\"staffName\":\"Nishad\"},\"confidence\":0.95}",
          "Cancel ticket 9 -> {\"intent\":\"cancelTicket\",\"params\":{\"ticketId\":9},\"confidence\":0.95}",
          "Delete ticket 15 -> {\"intent\":\"deleteTicket\",\"params\":{\"ticketId\":15},\"confidence\":0.95}",
          "Create new service request -> {\"intent\":\"createServiceRequest\",\"params\":{},\"confidence\":0.92}",
          "New lead for ARKAN ALDAR CONTRACTING contact Ms. george Dubai LOCATOR -> {\"intent\":\"createLead\",\"params\":{\"customerName\":\"ARKAN ALDAR CONTRACTING\",\"region\":\"Dubai\"},\"confidence\":0.93}",
          "Create migration ticket for KLEEMOL CAR RENTAL -> {\"intent\":\"createMigrationTicket\",\"params\":{\"customerName\":\"KLEEMOL CAR RENTAL\",\"serviceType\":\"migration\"},\"confidence\":0.93}",
          "Create installation ticket for KLEEMOL CAR RENTAL -> {\"intent\":\"createInstallationTicket\",\"params\":{\"customerName\":\"KLEEMOL CAR RENTAL\",\"serviceType\":\"installation\"},\"confidence\":0.93}",
    ].join("\n");

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

async function runOpenRouterIntentProvider(message: string): Promise<QueryProviderResult> {
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
    const raw = await runOpenRouterChatCompletion({
      model: extraLlmModel,
      reasoning: extraLlmReasoning,
      json: true,
      maxTokens: 500,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: [
            "You are SynoHub's safe intent detector.",
            "Return JSON only with keys: intent, params, confidence.",
            "Never generate SQL. Never claim an action was executed.",
            "Only choose one of these whitelisted intents:",
            allowedIntents,
            "Extract params such as ticketId, status, staffName, fromStaffName, region, customerName, value, serviceType, channelName, and limit.",
            `Known staff names: ${staffRoster.join(", ")}.`,
            "Examples:",
            "i want to know my pending list -> {\"intent\":\"getPendingTickets\",\"params\":{\"limit\":50},\"confidence\":0.93}",
            "Find ticket number 7 -> {\"intent\":\"getTicketById\",\"params\":{\"ticketId\":7},\"confidence\":0.97}",
            "Assign ticket 12 to Athul -> {\"intent\":\"assignTicket\",\"params\":{\"ticketId\":12,\"staffName\":\"Athul\"},\"confidence\":0.94}",
            "Create new service request -> {\"intent\":\"createServiceRequest\",\"params\":{},\"confidence\":0.92}",
          ].join("\n"),
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

async function runNvidiaIntentProvider(message: string): Promise<QueryProviderResult> {
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
    const raw = await runOpenRouterChatCompletion({
      model: openRouterModel,
      reasoning: true,
      json: true,
      maxTokens: 500,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: [
            "You are SynoHub's safe intent detector.",
            "Return JSON only with keys: intent, params, confidence.",
            "Never generate SQL. Never claim an action was executed.",
            "Only choose one of these whitelisted intents:",
            allowedIntents,
            "Extract params such as ticketId, status, staffName, fromStaffName, region, customerName, value, serviceType, channelName, and limit.",
            `Known staff names: ${staffRoster.join(", ")}.`,
          ].join("\n"),
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

function canonicalQueryParams(intent: SafeQueryIntent, params: Record<string, any> | undefined): Record<string, any> {
  const canonical: Record<string, any> = { ...(params || {}) };
  for (const key of Object.keys(canonical)) {
    if (canonical[key] === undefined || canonical[key] === null || canonical[key] === false) {
      delete canonical[key];
    }
  }
  if (intent === "getCompletedTicketsThisWeek") {
    delete canonical.dateRange;
  }
  return Object.keys(canonical)
    .sort()
    .reduce((acc: Record<string, any>, key) => {
      acc[key] = canonical[key];
      return acc;
    }, {});
}

function paramsMatch(intent: SafeQueryIntent, a: Record<string, any> | undefined, b: Record<string, any> | undefined): boolean {
  return JSON.stringify(canonicalQueryParams(intent, a)) === JSON.stringify(canonicalQueryParams(intent, b));
}

function chooseQueryProvider(
  mode: SafeQueryAiMode,
  providers: Record<QueryProviderName, QueryProviderResult>
): { winner: QueryProviderName; detected: DetectedQueryIntent; mismatch: boolean } {
  const geminiDetected = providerToDetected(providers.gemini);
  const localDetected = providerToDetected(providers.local);
  const nvidiaDetected = providerToDetected(providers.nvidia);
  const openrouterDetected = providerToDetected(providers.openrouter);

  if (mode === "gemini") {
    if (!geminiDetected) throw Object.assign(new Error(providers.gemini.error || `${cloudProviderLabel} intent detection failed.`), { statusCode: 400 });
    return { winner: "gemini", detected: geminiDetected, mismatch: false };
  }

  if (mode === "local") {
    if (!localDetected) throw Object.assign(new Error(providers.local.error || "Local intent detection failed."), { statusCode: 400 });
    return { winner: "local", detected: localDetected, mismatch: false };
  }

  if (mode === "nvidia") {
    if (!nvidiaDetected) throw Object.assign(new Error(providers.nvidia.error || `${openRouterPrimaryLabel} intent detection failed.`), { statusCode: 400 });
    return { winner: "nvidia", detected: nvidiaDetected, mismatch: false };
  }

  if (mode === "openrouter") {
    if (!openrouterDetected) throw Object.assign(new Error(providers.openrouter.error || "OpenRouter intent detection failed."), { statusCode: 400 });
    return { winner: "openrouter", detected: openrouterDetected, mismatch: false };
  }

  if (geminiDetected && localDetected) {
    const mismatch = geminiDetected.intent !== localDetected.intent || !paramsMatch(geminiDetected.intent, geminiDetected.params, localDetected.params);
    if (mismatch) {
      return { winner: "gemini", detected: geminiDetected, mismatch: true };
    }
    return (geminiDetected.confidence >= localDetected.confidence)
      ? { winner: "gemini", detected: geminiDetected, mismatch: false }
      : { winner: "local", detected: localDetected, mismatch: false };
  }

  if (geminiDetected) return { winner: "gemini", detected: geminiDetected, mismatch: true };
  if (localDetected) return { winner: "local", detected: localDetected, mismatch: true };

  throw Object.assign(new Error("Both intent providers failed."), { statusCode: 400 });
}

async function runDetectedSafeQuery(
  detected: DetectedQueryIntent,
  authUser: AuthUser,
  queryUser: Pick<AuthUser, "role" | "name">
): Promise<{ params: Record<string, any>; rows: any[]; answer: string }> {
  const validated = validateQueryIntent(detected, safeQueryHandlers);
  const params = validateQueryParams(validated, authUser);
  const roleScope = applyRoleScope(queryUser);
  if (roleScope.sql === "AND 1 = 0") {
    throw Object.assign(new Error("Access restricted. Your authenticated session is not valid for database queries."), { statusCode: 403 });
  }

  const handler = safeQueryHandlers[validated.intent];
  const rows = await handler({
    ...params,
    user: queryUser,
  });

  return {
    params,
    rows,
    answer: formatQueryAnswer(validated.intent, params, rows, queryUser),
  };
}

async function attachProviderAnswer(
  provider: QueryProviderName,
  providers: Record<QueryProviderName, QueryProviderResult>,
  authUser: AuthUser,
  queryUser: Pick<AuthUser, "role" | "name">
): Promise<any[]> {
  const detected = providerToDetected(providers[provider]);
  if (!detected) return [];

  try {
    const result = await runDetectedSafeQuery(detected, authUser, queryUser);
    providers[provider] = {
      ...providers[provider],
      params: result.params,
      answer: result.answer,
      rowCount: result.rows.length,
    };
    return result.rows;
  } catch (error) {
    providers[provider] = {
      ...providers[provider],
      error: (error as Error).message,
    };
    return [];
  }
}

function formatCompareProviderAnswer(
  providerLabel: string,
  provider: QueryProviderResult
): string {
  const meta = provider.intent
    ? `Intent: ${provider.intent} | Confidence: ${Number(provider.confidence || 0).toFixed(2)} | Time: ${provider.durationMs}ms`
    : `Intent: failed | Time: ${provider.durationMs}ms`;

  if (provider.error) {
    const providerName = providerLabel === openRouterPrimaryLabel || providerLabel === "Nex AGI" || providerLabel === "NVIDIA"
      ? "nvidia"
      : providerLabel === "Local LLM"
        ? "local"
        : providerLabel === "Cohere"
          ? "openrouter"
          : "gemini";
    return `${providerLabel}\n${meta}\nError: ${formatProviderError(providerName as QueryProviderName, provider.error)}`;
  }

  return `${providerLabel}\n${meta}\n\n${provider.answer || "No answer produced."}`;
}

function formatCompareWinnerReason(
  winner: QueryProviderName,
  providerChoice: { mismatch: boolean },
  providers: Record<QueryProviderName, QueryProviderResult>
): string {
  const geminiFailed = Boolean(providers.gemini.error);
  const localFailed = Boolean(providers.local.error);

  if (geminiFailed && !localFailed && winner === "local") {
    return ` (${cloudProviderLabel} unavailable, using Local LLM)`;
  }
  if (localFailed && !geminiFailed && winner === "gemini") {
    return ` (Local LLM unavailable, using ${cloudProviderLabel})`;
  }
  if (geminiFailed && localFailed) {
    return " (both providers failed)";
  }
  if (providerChoice.mismatch) {
    return " (intent or params mismatch)";
  }
  return "";
}

function runIntentDetectorFallback(message: string): Promise<DetectedQueryIntent | null> {
  return runLocalIntentProvider(message).then(providerToDetected);
}

function summarizeCustomer(row: any): string {
  const source = row.sourceType === "service_request" ? "service history" : "customer record";
  return `#${row.id} | ${row.name || row.customerName || "Unknown customer"} | ${row.phone || "No phone"} | ${row.email || "No email"} | ${row.region || "No region"} | Fleet: ${Number(row.vehicleCount || 0)} | ${source}`;
}

function cleanDuplicateCustomerLabel(value: unknown): string {
  return String(value || "Unknown customer")
    .replace(/\s+#\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatQueryAnswer(
  intent: SafeQueryIntent,
  params: Record<string, any>,
  rows: any[],
  queryUser?: Pick<AuthUser, "role" | "name">
): string {
  if (actionIntents.has(intent)) {
    return formatActionIntentAnswer(intent, params);
  }

  if (["findCustomerByName", "findCustomerByPhone", "findCustomerByEmail"].includes(intent)) {
    const count = rows.length;
    const label = intent === "findCustomerByPhone" ? "phone" : intent === "findCustomerByEmail" ? "email" : "name";
    const title = count === 0
      ? `No customer found matching ${label} search "${params.value}".`
      : `Yes, I found ${count} customer${count === 1 ? "" : "s"} matching ${label} search "${params.value}".`;
    return count === 0 ? title : `${title}\n\n${rows.slice(0, 10).map(summarizeCustomer).join("\n")}`;
  }

  if (intent === "getPendingTicketsByStaff") {
    return formatStaffWorkloadReport(params.staffName, rows, true, params);
  }

  if (intent === "getTicketsByStaff") {
    return formatStaffWorkloadReport(params.staffName, rows, false, params);
  }

  if (intent === "getOpenTicketsByRegion") {
    return formatRegionTicketReport(params.region, rows, { ...params, openOnly: true });
  }

  if (intent === "getTicketsByRegion") {
    return formatRegionTicketReport(params.region, rows, params);
  }

  if (intent === "getTicketsByServiceType") {
    return formatServiceTypeReport(params.serviceType, rows, params);
  }

  if (intent === "getTicketById") {
    return formatTicketLookup(params.ticketId, rows);
  }

  if (intent === "getTicketsByStatusLabel") {
    return formatStatusLabelReport(params.statusLabel, rows);
  }

  if (intent === "getCompletedTicketsThisWeek") {
    return formatQueueReport(rows, "completed tickets", { ...params, dateRange: "this_week" });
  }

  if (intent === "getTicketsNeedingAttention") {
    return formatTicketListReport("Tickets needing attention", rows, params);
  }

  if (intent === "getTicketsByCustomer") {
    return formatTicketListReport(`Tickets for ${params.customerName}`, rows, params);
  }

  if (intent === "getOpenTicketsByCustomer") {
    return formatTicketListReport(`Open tickets for ${params.customerName}`, rows, params);
  }

  if (intent === "getTicketsByIssue") {
    return formatTicketListReport(`Tickets matching "${params.value}"`, rows, params);
  }

  if (intent === "getUnassignedTickets") {
    return formatTicketListReport("Unassigned tickets", rows, params);
  }

  if (intent === "getMostCommonIssues") {
    return formatIssueSummary(rows, params.dateRange);
  }

  if (intent === "getCustomerWithMostRequests") {
    return formatTopCustomers(rows, params.dateRange);
  }

  if (intent === "getCustomerHistory") {
    const count = rows.length;
    return formatOperationalAnswer({
      title: `Customer history for ${params.customerName}`,
      direct: `Found ${count} visible record${count === 1 ? "" : "s"} for ${params.customerName}.`,
      details: rows.slice(0, 10).map(summarizeRow),
      suggestedActions: count > 0 ? [
        "- Review the latest IDs before creating a duplicate ticket.",
        "- Check open jobs for this customer if follow-up is needed.",
      ] : [
        "- Try a shorter customer name or alternate spelling.",
        "- Create a new lead if this is a brand-new customer.",
      ],
    });
  }

  if (intent === "getCustomerFleetSize") {
    const count = rows.length;
    const lines = rows.slice(0, 10).map(row => `${row.customerName}: ${Number(row.vehicleCount || 0)} vehicles${row.region ? ` | ${row.region}` : ""}`);
    return formatOperationalAnswer({
      title: `Fleet size for ${params.customerName}`,
      direct: `Found ${count} fleet-size result${count === 1 ? "" : "s"} for ${params.customerName}.`,
      details: lines,
    });
  }

  if (intent === "getCustomerRegion") {
    const count = rows.length;
    const lines = rows.slice(0, 10).map(row => `${row.customerName}: ${row.region || "No region"}${row.phone ? ` | ${row.phone}` : ""}`);
    return formatOperationalAnswer({
      title: `Customer region for ${params.customerName}`,
      direct: `Found ${count} region result${count === 1 ? "" : "s"} for ${params.customerName}.`,
      details: lines,
    });
  }

  if (["getPendingTickets", "getOpenTickets"].includes(intent)) {
    return formatQueueReport(rows, intent === "getPendingTickets" ? "pending service queue" : "open service queue", params);
  }

  if (["getCompletedTickets", "getLatestRequests"].includes(intent)) {
    const count = rows.length;
    const label = intent === "getCompletedTickets" ? "completed" : "latest";
    const totalMatches = Number(rows[0]?.totalMatches || rows.length);
    const guestScopeNote = queryUser?.role === "guest"
      ? "\nGuest access: only records created by this guest account are shown."
      : "";
    const title = intent === "getLatestRequests"
      ? `Showing latest ${count} visible ticket${count === 1 ? "" : "s"} out of ${totalMatches}${humanDateRangeLabel(params.dateRange)}.`
      : `Found ${totalMatches} ${label} ticket${totalMatches === 1 ? "" : "s"}${humanDateRangeLabel(params.dateRange)}.`;
    if (params.countOnly) return title;
    return count === 0
      ? `${title}${guestScopeNote}`
      : `${title}${guestScopeNote}\n\n${rows.slice(0, 10).map(summarizeRow).join("\n")}`;
  }

  if (intent === "getTechnicianWorkload") {
    if (rows.length === 0) return "No technician workload records found for your access level.";
    const lines = rows.slice(0, 10).map(row => `${row.staffName}: ${Number(row.openTickets || 0)} open / ${Number(row.totalTickets || 0)} total`);
    return formatOperationalAnswer({
      title: "Technician workload summary",
      direct: `Found workload data for ${rows.length} technician${rows.length === 1 ? "" : "s"}.`,
      details: lines,
      suggestedActions: [
        "- Assign new tickets to lower-load technicians where possible.",
        "- Review highest workload before adding urgent jobs.",
      ],
    });
  }

  if (intent === "getHighestWorkload") {
    if (rows.length === 0) return "No workload records found for your access level.";
    const row = rows[0];
    return formatOperationalAnswer({
      title: "Technician overload check",
      direct: `${row.staffName} has the highest visible workload with ${Number(row.openTickets || 0)} open tickets and ${Number(row.totalTickets || 0)} total records.`,
      suggestedActions: [
        "- Avoid assigning extra non-urgent jobs to this technician.",
        "- Check lowest workload for a possible reassignment option.",
      ],
    });
  }

  if (intent === "getLowestWorkload") {
    if (rows.length === 0) return "No workload records found for your access level.";
    const row = rows[0];
    const lines = rows.slice(0, 3).map(item => `${item.staffName}: ${Number(item.openTickets || 0)} open / ${Number(item.totalTickets || 0)} total`);
    return formatOperationalAnswer({
      title: "Available technician check",
      direct: `${row.staffName} currently has the lowest visible workload with ${Number(row.openTickets || 0)} open tickets.`,
      details: lines,
      suggestedActions: [
        "- Consider these technicians first for new low-priority assignments.",
        "- Confirm location before final dispatch.",
      ],
    });
  }

  if (intent === "getStaffPerformance") {
    if (rows.length === 0) return "No staff performance records found for your access level.";
    const lines = rows.slice(0, 10).map(row => `${row.staffName}: ${Number(row.completedRecords || 0)} completed / ${Number(row.totalRecords || 0)} total`);
    return formatOperationalAnswer({
      title: "Staff performance summary",
      direct: `Found performance data for ${rows.length} staff member${rows.length === 1 ? "" : "s"}.`,
      details: lines,
      suggestedActions: [
        "- Compare completion count with current workload before reassigning tickets.",
        "- Review pending jobs for high-volume staff.",
      ],
    });
  }

  if (intent === "getDuplicateRequests") {
    if (rows.length === 0) return "No duplicate requests found for your access level.";
    const lines = rows.slice(0, 10).map(row => `${cleanDuplicateCustomerLabel(row.customerName || row.customerKey)}: ${row.duplicateCount} duplicates, latest ID ${row.latestId}`);
    return formatOperationalAnswer({
      title: "Duplicate request detection",
      direct: `Found ${rows.length} possible duplicate customer/request group${rows.length === 1 ? "" : "s"}.`,
      details: lines,
      suggestedActions: [
        "- Check the latest ID before creating or assigning another ticket.",
        "- Merge or close accidental duplicates where policy allows.",
      ],
    });
  }

  if (intent === "getDashboardSummary") {
    const row = rows[0] || {};
    const totalRecords = Number(row.totalRecords || 0);
    const registeredCustomers = Number(row.registeredCustomers || row.uniqueCustomers || 0);
    const openRecords = Number(row.openRecords || 0);
    const newRecords = Number(row.newRecords || 0);
    const completedRecords = Number(row.completedRecords || 0);
    const totalUnits = Number(row.totalUnits || 0);
    const totalOperationalRecords = totalRecords + registeredCustomers;
    return formatOperationalAnswer({
      title: "SynoHub operational dashboard",
      direct: `The SynoHub CRM currently has ${totalOperationalRecords} visible operational records across registered customers and service/lead records.`,
      breakdown: [
        `- Registered Customers: ${registeredCustomers}`,
        `- Lead / Service Records: ${totalRecords}`,
        `- Open Records: ${openRecords}`,
        `- New Records: ${newRecords}`,
        `- Completed Records: ${completedRecords}`,
        `- Total Units: ${totalUnits}`,
      ],
      suggestedActions: [
        "- View pending service queue for dispatch priorities.",
        "- Check technician workload before assigning new tickets.",
        "- Review status summary for completed, open, and new records.",
      ],
    });
  }

  if (intent === "getRegionSummary") {
    if (rows.length === 0) return "No region summary records found for your access level.";
    const lines = rows.slice(0, 10).map(row => `${row.region}: ${Number(row.totalRecords || 0)} records, ${Number(row.openRecords || 0)} open, ${Number(row.totalUnits || 0)} units`);
    return formatOperationalAnswer({
      title: params.region ? `${params.region} region summary` : "Region summary",
      direct: `Found ${rows.length} region summar${rows.length === 1 ? "y" : "ies"} visible to you.`,
      details: lines,
      suggestedActions: [
        "- Review open counts before planning route-wise dispatch.",
        "- Use technician workload to balance region assignments.",
      ],
    });
  }

  if (intent === "getStatusSummary") {
    if (rows.length === 0) return "No status summary records found for your access level.";
    const lines = rows.slice(0, 10).map(row => `${row.status}: ${Number(row.totalRecords || 0)} records`);
    return formatOperationalAnswer({
      title: "Status summary",
      direct: `Found ${rows.length} status bucket${rows.length === 1 ? "" : "s"} visible to you.`,
      details: lines,
    });
  }

  if (intent === "getDailySummary") {
    if (rows.length === 0) return "No daily summary records found for your access level.";
    const lines = rows.slice(0, 10).map(row => `${row.day}: ${Number(row.totalRecords || 0)} total, ${Number(row.openRecords || 0)} open, ${Number(row.completedRecords || 0)} completed`);
    return formatOperationalAnswer({
      title: "Daily summary",
      direct: `Found ${rows.length} day${rows.length === 1 ? "" : "s"} of visible service activity.`,
      details: lines,
      suggestedActions: [
        "- Review days with high open counts first.",
        "- Use the pending queue for current dispatch planning.",
      ],
    });
  }

  if (intent === "getMonthlySummary") {
    if (rows.length === 0) return "No monthly summary records found for your access level.";
    const lines = rows.slice(0, 12).map(row => `${row.month}: ${Number(row.totalRecords || 0)} total, ${Number(row.openRecords || 0)} open, ${Number(row.completedRecords || 0)} completed`);
    return formatOperationalAnswer({
      title: "Monthly summary",
      direct: `Found ${rows.length} month${rows.length === 1 ? "" : "s"} of visible service activity.`,
      details: lines,
      suggestedActions: [
        "- Compare open counts month to month for queue pressure.",
        "- Review technician performance for completion trends.",
      ],
    });
  }

  if (["getStaffChatHistory", "getGuestChatHistory"].includes(intent)) {
    const count = rows.length;
    const title = `Found ${count} chat message${count === 1 ? "" : "s"}.`;
    const lines = rows.slice(0, 10).map(row => `${row.username} | ${row.role}: ${cleanRecordDescription(row.content).slice(0, 140)}`);
    return count === 0 ? title : `${title}\n\n${lines.join("\n")}`;
  }

  const count = rows.length;
  const title = `Found ${count} latest record${count === 1 ? "" : "s"}.`;
  return count === 0 ? title : `${title}\n\n${rows.slice(0, 10).map(summarizeRow).join("\n")}`;
}

// Helper to handle AI record saving/updating/deletion via trigger tags
function mapInputToSchema(input: any): any {
  if (!input || typeof input !== "object") return {};
  const schema: any = {};
  
  const getVal = (camel: string, snake: string, ...alts: string[]) => {
    if (input[camel] !== undefined) return input[camel];
    if (input[snake] !== undefined) return input[snake];
    for (const alt of alts) {
      if (input[alt] !== undefined) return input[alt];
    }
    return undefined;
  };

  const assignIfDefined = (targetKey: string, camel: string, snake: string, ...alts: string[]) => {
    const val = getVal(camel, snake, ...alts);
    if (val !== undefined) {
      schema[targetKey] = val;
    }
  };

  assignIfDefined("source", "source", "source");
  assignIfDefined("region", "region", "region");
  assignIfDefined("status", "status", "status");
  assignIfDefined("implementationType", "implementationType", "implementation_type");
  assignIfDefined("customerName", "customerName", "customer_name");
  assignIfDefined("contactName", "contactName", "contact_name");
  assignIfDefined("phone", "phone", "phone");
  assignIfDefined("email", "email", "email");
  assignIfDefined("address", "address", "address");
  assignIfDefined("mapLink", "mapLink", "map_link");
  assignIfDefined("coordinates", "coordinates", "coordinates");
  
  assignIfDefined("newQty", "newQty", "new_qty", "qty", "quantity");
  assignIfDefined("migrateQty", "migrateQty", "migrate_qty");
  assignIfDefined("tradingQty", "tradingQty", "trading_qty");
  assignIfDefined("serviceQty", "serviceQty", "service_qty");
  assignIfDefined("otherQty", "otherQty", "other_qty");
  assignIfDefined("accessories", "accessories", "accessories");
  
  assignIfDefined("requestedPerson", "requestedPerson", "requested_person");
  assignIfDefined("salesPerson", "salesPerson", "sales_person");
  assignIfDefined("salesType", "salesType", "sales_type");
  
  assignIfDefined("projectValue", "projectValue", "project_value");
  assignIfDefined("priceDetails", "priceDetails", "price_details");
  assignIfDefined("comment", "comment", "comment");
  
  assignIfDefined("issueDescription", "issueDescription", "issue_description", "description");
  assignIfDefined("location", "location", "location");
  assignIfDefined("paymentStatus", "paymentStatus", "payment_status", "payment");
  assignIfDefined("amount", "amount", "amount");
  assignIfDefined("vehicleDetails", "vehicleDetails", "vehicle_details");
  assignIfDefined("notes", "notes", "notes");
  assignIfDefined("jobStatus", "jobStatus", "job_status", "status");
  assignIfDefined("createdAt", "createdAt", "created_at");

  return schema;
}

async function saveForcedServiceRequestFromMessage(input: string, authUser: AuthUser): Promise<ForcedServiceRequestResult | null> {
  const parsed = parseForcedServiceRequest(input);
  if (!parsed) return null;
  return saveForcedServiceRequestFields(parsed, authUser, extractRegionName);
}

async function handleAIRecordSave(reply: string, userRole: string = "guest", userName: string = ""): Promise<{ reply: string; savedRecord?: any }> {
  // 1. Process [[DELETE_RECORD:...]]
  const deleteMatch = findRecordTrigger(reply, "DELETE_RECORD");
  if (deleteMatch) {
    try {
      if (userRole !== "admin") {
        console.warn(`[Security Alert] Non-admin user "${userName}" tried to delete a record via AI.`);
        if (userRole === "staff") {
          return {
            reply: `Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator.`
          };
        }
        return {
          reply: removeRecordTrigger(reply, deleteMatch) + `\n\n(Authorization Warning: Access Denied. Only system administrators can delete records.)`
        };
      }

      const rawJson = extractRecordTriggerJson(deleteMatch.body);
      const record = JSON.parse(rawJson);
      const id = parseInt(record.id);
      console.log(`[AI Auto-Delete] Detected record: ${record.type}, ID: ${id}`);
      if (record.type === "registration") {
        await db.delete(serviceRequests).where(eq(serviceRequests.id, id));
        return {
          reply: removeRecordTrigger(reply, deleteMatch) + `\n\n(CRM: Registration record #${id} deleted successfully by Admin.)`
        };
      } else if (record.type === "service") {
        await db.delete(serviceRequests).where(eq(serviceRequests.id, id));
        return {
          reply: removeRecordTrigger(reply, deleteMatch) + `\n\n(CRM: Service ticket record #${id} deleted successfully by Admin.)`
        };
      } else if (record.type === "customer") {
        await db.delete(customers).where(eq(customers.id, id));
        return {
          reply: removeRecordTrigger(reply, deleteMatch) + `\n\n(CRM: Customer account record #${id} deleted successfully by Admin.)`
        };
      }
    } catch (e) {
      console.error("AI Auto-Delete failed:", e);
    }
  }

  // 2. Process [[UPDATE_RECORD:...]]
  const updateMatch = findRecordTrigger(reply, "UPDATE_RECORD");
  if (updateMatch) {
    try {
      if (userRole === "guest") {
        return {
          reply: removeRecordTrigger(reply, updateMatch) + `\n\n(Authorization Warning: Access Denied. Public guest users cannot update records.)`
        };
      }

      const rawJson = extractRecordTriggerJson(updateMatch.body);
      const record = JSON.parse(rawJson);
      const id = parseInt(record.id);
      console.log(`[AI Auto-Update] Detected record update: ${record.type}, ID: ${id}`);
      
      // Staff authorization validation: Staff coordinators cannot edit previous/existing records
      if (userRole === "staff") {
        console.warn(`[Security Guard] Staff member "${userName}" attempted to edit record #${id} via SynoAI.`);
        return {
          reply: `Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator.`
        };
      }

      if (record.type === "registration") {
        const mappedData = mapInputToSchema(record.data);
        await db.update(serviceRequests).set(mappedData).where(eq(serviceRequests.id, id));
        return {
          reply: removeRecordTrigger(reply, updateMatch) + `\n\n(CRM: Registration #${id} updated successfully.)`
        };
      } else if (record.type === "service") {
        const mappedData = mapInputToSchema(record.data);
        await db.update(serviceRequests).set(mappedData).where(eq(serviceRequests.id, id));
        return {
          reply: removeRecordTrigger(reply, updateMatch) + `\n\n(CRM: Service ticket #${id} updated successfully.)`
        };
      } else if (record.type === "customer") {
        if (userRole !== "admin") {
          return {
            reply: removeRecordTrigger(reply, updateMatch) + `\n\n(Authorization Warning: Access Denied. Only system administrators can edit customer accounts.)`
          };
        }
        const mappedCustomer: any = {};
        if (record.data.name || record.data.customer_name) mappedCustomer.name = record.data.name || record.data.customer_name;
        if (record.data.contactName || record.data.contact_name) mappedCustomer.contactName = record.data.contactName || record.data.contact_name;
        if (record.data.phone) mappedCustomer.phone = record.data.phone;
        if (record.data.email) mappedCustomer.email = record.data.email;
        if (record.data.region) mappedCustomer.region = record.data.region;
        if (record.data.implementationType || record.data.implementation_type) mappedCustomer.implementationType = record.data.implementationType || record.data.implementation_type;
        if (record.data.vehicleCount !== undefined || record.data.vehicle_count !== undefined) mappedCustomer.vehicleCount = record.data.vehicleCount !== undefined ? record.data.vehicleCount : record.data.vehicle_count;
        
        await db.update(customers).set(mappedCustomer).where(eq(customers.id, id));
        return {
          reply: removeRecordTrigger(reply, updateMatch) + `\n\n(CRM: Customer account #${id} updated successfully.)`
        };
      }
    } catch (e) {
      console.error("AI Auto-Update failed:", e);
    }
  }

  // 3. Process [[SAVE_RECORD:...]]
  const saveMatch = findRecordTrigger(reply, "SAVE_RECORD");
  if (!saveMatch) return { reply };

  try {
    const rawJson = extractRecordTriggerJson(saveMatch.body);
    const record = JSON.parse(rawJson);
    console.log(`[AI Auto-Save] Detected record save: ${record.type} by role=${userRole}`);
    
    if (record.type === "registration") {
      const mapped = mapInputToSchema(record);
      // Ensure the staff member's ticket is assigned to them automatically
      if (userRole === "staff" && userName) {
        mapped.requestedPerson = userName;
      }
      
      const [res]: any = await db.insert(serviceRequests).values({
        customerName: mapped.customerName || "Unknown",
        contactName: mapped.contactName || "",
        phone: mapped.phone || "",
        email: mapped.email || "",
        region: mapped.region || "",
        address: mapped.address || "",
        mapLink: mapped.mapLink || "",
        coordinates: mapped.coordinates || "",
        source: mapped.source || "",
        status: mapped.status || "New Lead",
        implementationType: mapped.implementationType || "",
        salesPerson: mapped.salesPerson || "",
        salesType: mapped.salesType || "",
        requestedPerson: mapped.requestedPerson || "",
        comment: mapped.comment || "",
        projectValue: mapped.projectValue || "",
        priceDetails: mapped.priceDetails || "",
        accessories: mapped.accessories || "",
        newQty: mapped.newQty || 0,
        migrateQty: mapped.migrateQty || 0,
        tradingQty: mapped.tradingQty || 0,
        serviceQty: mapped.serviceQty || 0,
        otherQty: mapped.otherQty || 0,
        createdBy: userName || 'guest'
      });

      try {
        await saveLocalSalesplusEntry(mapped, res.insertId, mapped.requestedPerson || "");
      } catch (salesplusErr) {
        console.error("Failed to save local Salesplus entry:", salesplusErr);
      }

      // Synchronize registration customer to customers table
      try {
        const syncResult = await syncRegistrationCustomer(mapped, userName || "guest", 1);
        if (syncResult.action === "created") {
          console.log(`[AI Auto-Save] Synchronized customer ${syncResult.customerName} into customers table.`);
        } else if (syncResult.action === "updated") {
          console.log(`[AI Auto-Save] Updated existing customer ${syncResult.customerName} vehicleCount to ${syncResult.vehicleCount}`);
        }
      } catch (custErr) {
        console.error("Failed to auto-sync customer:", custErr);
      }

      return {
        reply: removeRecordTrigger(reply, saveMatch) + `\n\n(CRM: Registration saved successfully. ID: ${res.insertId})`,
        savedRecord: { ...record, id: res.insertId }
      };
    } else if (record.type === "service") {
      const ticketId = record.ticketId || ('TKT-' + crypto.randomBytes(4).toString('hex').toUpperCase());
      const mapped = mapInputToSchema(record);
      if (userRole === "staff" && userName) {
        mapped.requestedPerson = userName;
      }
      
      const [res]: any = await db.insert(serviceRequests).values({
        customerName: mapped.customerName || "Unknown",
        issueDescription: mapped.issueDescription || "",
        jobStatus: mapped.jobStatus || "New",
        newQty: mapped.newQty || 1,
        requestedPerson: mapped.requestedPerson || "",
        paymentStatus: mapped.paymentStatus || "",
        amount: mapped.amount || "",
        salesPerson: mapped.salesPerson || "",
        createdBy: userName || 'guest'
      });
      return {
        reply: removeRecordTrigger(reply, saveMatch) + `\n\n(CRM: Service ticket ${ticketId} created successfully.)`,
        savedRecord: { ...record, id: res.insertId, ticketId }
      };
    }
    return { reply: removeRecordTrigger(reply, saveMatch) };
  } catch (pErr) {
    console.error("Failed to parse or save AI record:", pErr);
    return {
      reply: removeRecordTrigger(reply, saveMatch) + "\n\n(System: Failed to auto-save record. Please try manual entry.)"
    };
  }
}

export async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);
  const httpServer = createHttpServer(app);

  try {
    await initDB();
  } catch (err) {
    console.error("Critical: Could not initialize database. App may fail.", err);
  }

  app.use(express.json());

  // --- API Routes ---

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Login handler
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    const normalizedUser = username.trim().toLowerCase();
    
    // System Admin login check
    if (normalizedUser === "admin" && (password === "admin" || password === configuredAdminPassword)) {
      const authUser = { sub: "admin", role: "admin" as const, name: "Administrator" };
      return res.json({
        success: true,
        token: issueToken(authUser),
        role: authUser.role,
        name: authUser.name
      });
    }

    if (allowedStaff.includes(normalizedUser)) {
      // Allow 'staff123', the custom STAFF_PASSWORD, or the employee's own name in lowercase
      const allowedPasswords = ["staff123", configuredStaffPassword, normalizedUser];
      if (allowedPasswords.includes(password)) {
        const properName = staffRoster.find(p => p.toLowerCase() === normalizedUser) || username;
        const authUser = { sub: `staff:${normalizedUser}`, role: "staff" as const, name: properName };
        return res.json({
          success: true,
          token: issueToken(authUser),
          role: authUser.role,
          name: authUser.name
        });
      }
    }

    return res.status(401).json({ error: "Incorrect username or password. Check credentials roster." });
  });

  app.post("/api/guest-session", (_req, res) => {
    const guestId = crypto.randomBytes(8).toString("hex");
    const authUser = {
      sub: `guest:${guestId}`,
      role: "guest" as const,
      name: `Guest-${guestId}`,
    };
    res.json({
      success: true,
      token: issueToken(authUser),
      role: authUser.role,
      name: authUser.name
    });
  });

  // Get all dashboard data
  app.get("/api/data", requireAuth, async (req, res) => {
    try {
      res.json(await getDashboardData(getAuthUser(req)));
    } catch (error) {
      console.error("Dashboard data fetch failed:", error);
      res.status(500).json({ 
        error: (error as Error).message,
        details: "Check database connection and table existence. Ensure initDB completed successfully.",
        connectionConfig: {
          host: process.env.DB_HOST || 'localhost (127.0.0.1)',
          port: process.env.DB_PORT || '3306/3307',
          user: process.env.DB_USER || 'root',
          database: process.env.DB_NAME || 'testdb',
          socketPath: process.env.DB_SOCKET || 'not provided',
          passwordProvided: !!process.env.DB_PASSWORD
        }
      });
    }
  });

  // Create new registration
  app.post("/api/leads/new", requireAuth, async (req, res) => {
    try {
      const result = await createLeadRegistration(req.body, getAuthUser(req));
      res.json({ success: true, id: result.insertId, message: 'Registration created' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Create service request
  app.post("/api/services", requireAuth, async (req, res) => {
    try {
      const result = await createServiceTicket(req.body, getAuthUser(req));
      res.json({ success: true, id: result.insertId, ticket_id: result.insertId ? ("TKT-" + result.insertId) : "", message: 'Service ticket created' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Edit/Update lead registration
  app.put("/api/leads/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const authUser = getAuthUser(req);
      const userRole = authUser.role;

      if (userRole === "guest") {
        return res.status(403).json({ error: "Access Denied. Public guest users cannot update records." });
      }

      const recordId = parseInt(id);
      if (userRole === "staff") {
        return res.status(403).json({ error: "Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator." });
      }

      await updateLeadRegistration(recordId, req.body);
      res.json({ success: true, message: "Lead registration updated and customer synchronized successfully" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Delete lead registration
  app.delete("/api/leads/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userRole = getAuthUser(req).role;
      if (userRole === "staff") {
        return res.status(403).json({ error: "Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator." });
      }
      if (userRole !== "admin") {
        return res.status(403).json({ error: "Access Denied. Only system administrators can delete records." });
      }

      await deleteLeadRegistration(parseInt(id));
      res.json({ success: true, message: "Lead registration deleted successfully by Admin" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Edit/Update service task
  app.put("/api/services/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userRole = getAuthUser(req).role;

      if (userRole === "guest") {
        return res.status(403).json({ error: "Access Denied. Public guest users cannot update records." });
      }

      const recordId = parseInt(id);
      if (userRole === "staff") {
        return res.status(403).json({ error: "Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator." });
      }

      await updateServiceTicket(recordId, req.body);
      res.json({ success: true, message: "Service ticket updated successfully" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Delete service task
  app.delete("/api/services/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userRole = getAuthUser(req).role;
      if (userRole === "staff") {
        return res.status(403).json({ error: "Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator." });
      }
      if (userRole !== "admin") {
        return res.status(403).json({ error: "Access Denied. Only system administrators can delete records." });
      }

      await deleteServiceTicket(parseInt(id));
      res.json({ success: true, message: "Service ticket deleted successfully by Admin" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Edit/Update customer definition
  app.put("/api/customers/:id", requireAuth, requireRoles("admin"), async (req, res) => {
    try {
      const { id } = req.params;

      const b = req.body;
      await db.update(customers).set({
        name: b.name,
        contactName: b.contactName,
        phone: b.phone,
        email: b.email,
        region: b.region,
        implementationType: b.implementationType,
        vehicleCount: parseInt(b.vehicleCount || 0)
      }).where(eq(customers.id, parseInt(id)));
      res.json({ success: true, message: "Customer account updated successfully by Admin" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Delete customer definition
  app.delete("/api/customers/:id", requireAuth, requireRoles("admin"), async (req, res) => {
    try {
      const { id } = req.params;

      await db.delete(customers).where(eq(customers.id, parseInt(id)));
      res.json({ success: true, message: "Customer account deleted successfully by Admin" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Customer search
  app.get("/api/customers", requireAuth, async (req, res) => {
    try {
      const authUser = getAuthUser(req);
      const userRole = authUser.role;
      const userName = normalizeUserName(authUser.name);
      const q = req.query.q as string;
      const rawResults = q 
        ? await db.select().from(customers).where(or(like(customers.name, `%${q}%`), like(customers.contactName, `%${q}%`)))
        : await db.select().from(customers);

      let results = rawResults;
      if (userRole === "guest") {
        results = rawResults.filter(c => normalizeUserName(c.createdBy || "") === userName);
      } else if (userRole === "staff") {
        const rawRequests = await db.select().from(serviceRequests).orderBy(desc(serviceRequests.id)).limit(1000);
        const allowedCustomerNames = new Set(
          rawRequests
            .filter(r => {
              const salesPerson = normalizeUserName(r.salesPerson || "");
              const reqPerson = normalizeUserName(r.requestedPerson || "");
              const createdByVal = normalizeUserName(r.createdBy || "");
              return salesPerson === userName || reqPerson === userName || createdByVal === userName;
            })
            .map(r => normalizeUserName(r.customerName || ""))
        );
        results = rawResults.filter(c => allowedCustomerNames.has(normalizeUserName(c.name || "")) || normalizeUserName(c.createdBy || "") === userName);
      }

      res.json({ results, total: results.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Safe natural-language query endpoint. This route never asks AI to generate SQL.
  app.post("/api/chat/query", requireAuth, async (req, res) => {
    let detectedForError: DetectedQueryIntent | null = null;
    try {
      const authUser = getAuthUser(req);
      const queryUser = { role: authUser.role, name: authUser.name };
      const chatIdentity = resolveChatIdentity(authUser);
      const message = normalizeQueryText(req.body?.message || req.body?.question || req.body?.query);
      const aiMode = normalizeQueryAiMode(req.body?.aiMode, authUser);
      const compareProviders = normalizeCompareProviders(req.body?.compareProviders);
      const chatChannel = getModeScopedChatChannel(chatIdentity.channel, aiMode);

      if (!message) {
        return res.status(400).json({ error: "Question is required." });
      }

      await saveChatMessage("user", message, chatChannel);

      const forcedServiceRequest = await saveForcedServiceRequestFromMessage(message, authUser);
      if (forcedServiceRequest) {
        await saveChatMessage("assistant", cleanVisibleAssistantText(forcedServiceRequest.answer), chatChannel);

        return res.json({
          answer: cleanVisibleAssistantText(forcedServiceRequest.answer),
          reply: cleanVisibleAssistantText(forcedServiceRequest.answer),
          mode: aiMode,
          winner: "backend",
          intent: "createServiceRequest",
          customerMatched: forcedServiceRequest.customerMatched,
          customerCreated: forcedServiceRequest.customerCreated,
          customerId: forcedServiceRequest.customerId,
          serviceRequestId: forcedServiceRequest.serviceRequestId,
          salesplusSaved: forcedServiceRequest.salesplusSaved,
          extracted: forcedServiceRequest.fields,
          rows: [],
        });
      }

      const providers: Record<QueryProviderName, QueryProviderResult> = {
        gemini: { durationMs: 0, error: "Not run for this mode." },
        local: { durationMs: 0, error: "Not run for this mode." },
        nvidia: { durationMs: 0, error: "Not run for this mode." },
        openrouter: { durationMs: 0, error: "Not run for this mode." },
      };

      if (aiMode === "compare") {
        await Promise.all(compareProviders.map(async (provider) => {
          if (provider === "gemini") providers.gemini = await runGeminiIntentProvider(message);
          if (provider === "local") providers.local = await runLocalIntentProvider(message);
          if (provider === "nvidia") providers.nvidia = await runNvidiaIntentProvider(message);
          if (provider === "openrouter") providers.openrouter = await runOpenRouterIntentProvider(message);
        }));
      } else if (aiMode === "gemini") {
        providers.gemini = await runGeminiIntentProvider(message);
      } else if (aiMode === "nvidia") {
        providers.nvidia = await runNvidiaIntentProvider(message);
      } else if (aiMode === "openrouter") {
        providers.openrouter = await runOpenRouterIntentProvider(message);
      } else {
        providers.local = await runLocalIntentProvider(message);
      }

      if (aiMode === "compare") {
        const rowEntries = await Promise.all(compareProviders.map(async (provider) => {
          return [provider, await attachProviderAnswer(provider, providers, authUser, queryUser)] as const;
        }));
        const rowsByProvider = Object.fromEntries(rowEntries) as Partial<Record<QueryProviderName, any[]>>;
        const detectedProviders = compareProviders
          .map(provider => ({ provider, detected: providerToDetected(providers[provider]) }))
          .filter((item): item is { provider: QueryProviderName; detected: DetectedQueryIntent } => Boolean(item.detected));

        if (detectedProviders.length === 0) {
          throw Object.assign(new Error("All selected compare providers failed."), { statusCode: 400 });
        }

        const winner = detectedProviders
          .sort((a, b) => b.detected.confidence - a.detected.confidence)[0].provider;
        const winnerDetected = validateQueryIntent(providerToDetected(providers[winner]), safeQueryHandlers);
        detectedForError = winnerDetected;
        const rows = rowsByProvider[winner] || [];
        const signatures = new Set(detectedProviders.map(item => {
          return `${item.detected.intent}:${JSON.stringify(canonicalQueryParams(item.detected.intent, item.detected.params))}`;
        }));
        const mismatch = signatures.size > 1;
        const answer = cleanVisibleAssistantText([
          `Compare Both result. Winner: ${getProviderLabel(winner)}${mismatch ? " (intent or params mismatch)" : ""}.`,
          "",
          ...compareProviders.flatMap(provider => [
            formatCompareProviderAnswer(getProviderLabel(provider), providers[provider]),
            "",
          ]),
        ].join("\n"));

        await saveChatMessage("assistant", answer, chatChannel);

        return res.json({
          answer,
          mode: aiMode,
          winner,
          intent: winnerDetected.intent,
          providers,
          compareProviders,
          mismatch,
          rows,
        });
      }

      const providerChoice = chooseQueryProvider(aiMode, providers);
      const detected = validateQueryIntent(providerChoice.detected, safeQueryHandlers);
      detectedForError = detected;

      const result = await runDetectedSafeQuery(detected, authUser, queryUser);
      const answer = cleanVisibleAssistantText(result.answer);
      const rows = result.rows;
      providers[providerChoice.winner] = {
        ...providers[providerChoice.winner],
        params: result.params,
        answer,
        rowCount: rows.length,
      };

      await saveChatMessage("assistant", answer, chatChannel);

      return res.json({
        answer,
        mode: aiMode,
        winner: providerChoice.winner,
        intent: detected.intent,
        rows,
      });
    } catch (error: any) {
      const statusCode = typeof error?.statusCode === "number" ? error.statusCode : 500;
      const answer = cleanVisibleAssistantText(error?.message || "Safe query failed.");

      try {
        const authUser = getAuthUser(req);
        const chatIdentity = resolveChatIdentity(authUser);
        const aiMode = normalizeQueryAiMode(req.body?.aiMode, authUser);
        await saveChatMessage("assistant", answer, getModeScopedChatChannel(chatIdentity.channel, aiMode));
      } catch {
        // Do not mask the original query error with a history-write error.
      }

      return res.status(statusCode).json({
        answer,
        intent: detectedForError?.intent || "unknown",
        rows: [],
      });
    }
  });

  // Chat/AI endpoint
  app.post("/api/chat", requireAuth, async (req, res) => {
    try {
      const { message, selectedChatTarget, selectedUsername } = req.body;
      const authUser = getAuthUser(req);
      const aiMode = normalizeQueryAiMode(req.body?.aiMode, authUser);
      const compareProviders = normalizeCompareProviders(req.body?.compareProviders);
      const chatProviderMode = aiMode === "compare" ? compareProviders[0] : aiMode;
      const chatIdentity = resolveChatIdentity(authUser, selectedChatTarget || selectedUsername);
      let userRole = chatIdentity.role;
      let userName = chatIdentity.name;
      const chatChannel = getModeScopedChatChannel(chatIdentity.channel, aiMode);

      if (authUser.role === "admin" && chatIdentity.channel !== "admin") {
        return res.status(403).json({ error: "Admin can only view guest and staff chats. Switch to Admin chat to send messages." });
      }

      const persistedHistory = await getRecentChatMessages(chatChannel, 12);
      const chatHistory = persistedHistory
        .reverse()
        .map((h: any) => ({ role: h.role, content: h.content }));

      // Save user message (partitioned by username)
      await saveChatMessage("user", message, chatChannel);

      const forcedServiceRequest = await saveForcedServiceRequestFromMessage(message, authUser);
      if (forcedServiceRequest) {
        const reply = cleanVisibleAssistantText(forcedServiceRequest.answer);
        await saveChatMessage("assistant", reply, chatChannel);

        return res.json({
          reply,
          savedRecord: {
            id: forcedServiceRequest.serviceRequestId,
            type: "service",
            customerId: forcedServiceRequest.customerId,
            customerMatched: forcedServiceRequest.customerMatched,
            customerCreated: forcedServiceRequest.customerCreated,
            salesplusSaved: forcedServiceRequest.salesplusSaved,
            ...forcedServiceRequest.fields,
          },
          intent: "createServiceRequest",
          customerMatched: forcedServiceRequest.customerMatched,
          customerCreated: forcedServiceRequest.customerCreated,
          customerId: forcedServiceRequest.customerId,
          serviceRequestId: forcedServiceRequest.serviceRequestId,
          salesplusSaved: forcedServiceRequest.salesplusSaved,
          extracted: forcedServiceRequest.fields,
        });
      }

      if (isGenericTicketCreationPrompt(message)) {
        const reply = cleanVisibleAssistantText(formatGenericTicketCreationPrompt(userRole, userName));
        await saveChatMessage("assistant", reply, chatChannel);
        return res.json({ reply });
      }

      // Guest security rules check
      let prependAccessRestricted = false;
      if (userRole === "guest") {
        const normalized = message.toLowerCase().trim();
        const isGuestRecordsLookup =
          /\b(latest|last|recent)\s+(\d+\s+)?(record|records|request|requests|ticket|tickets|lead|leads)\b/.test(normalized) ||
          /\b(show|list|view)\s+(my\s+)?(latest|last|recent|record|records|request|requests|ticket|tickets|lead|leads)\b/.test(normalized) ||
          /\b(is\s+)?this\s+(all|only)\s+(by|from)\s+guest\b/.test(normalized);
        const attemptedBlockedAction = 
          normalized.includes("show all") ||
          normalized.includes("list all") ||
          normalized.includes("view all") ||
          normalized.includes("all records") ||
          normalized.includes("all customers") ||
          normalized.includes("all tickets") ||
          normalized.includes("all registrations") ||
          normalized.includes("every request") ||
          normalized.includes("entire database") ||
          normalized.includes("comprehensive") ||
          normalized.includes("workload") || 
          normalized.includes("technician workload") ||
          normalized.includes("database summary") ||
          normalized.includes("system summary") ||
          normalized.includes("system-wide") ||
          normalized.includes("show athul") ||
          normalized.includes("athul tickets") ||
          normalized.includes("other guest") ||
          normalized.includes("other guests") ||
          normalized.includes("complete customer database");

        if (attemptedBlockedAction) {
          prependAccessRestricted = true;
        }

        if (isGuestRecordsLookup && userName) {
          const countMatch = normalized.match(/\b(\d{1,2})\b/);
          const requestedCount = countMatch ? parseInt(countMatch[1], 10) : 10;
          const limitCount = Math.min(Math.max(requestedCount, 1), 25);
          const lowerUser = userName.toLowerCase().trim();
          const guestRows = await db.select().from(serviceRequests)
            .where(eq(serviceRequests.createdBy, lowerUser))
            .orderBy(desc(serviceRequests.id))
            .limit(limitCount);

          const guestReply = cleanVisibleAssistantText(guestRows.length === 0
            ? "Fresh guest session: there are no records or previous chats linked to this guest account yet. You can create a new ticket now, and only records created in this guest session will appear here."
            : formatStaffRecordList(`Latest ${guestRows.length} records for this guest session`, guestRows));

          await saveChatMessage("assistant", guestReply, chatChannel);
          return res.json({ reply: guestReply });
        }
      }

      // Staff security rules check
      if (userRole === "staff") {
        const normalized = message.toLowerCase().trim();
        const isPendingLookup =
          /\b(my\s+)?pending\s+(request|requests|ticket|tickets|lead|leads)\b/.test(normalized) ||
          /\b(open|ongoing|hold)\s+(request|requests|ticket|tickets|lead|leads)\b/.test(normalized) ||
          normalized === "pending request please" ||
          normalized === "pending requests please";
        const isLatestRecordsLookup =
          /\b(latest|last|recent)\s+(\d+\s+)?(record|records|request|requests|ticket|tickets|lead|leads)\b/.test(normalized) ||
          /\b(show|list|view)\s+(my\s+)?(latest|last|recent)\b/.test(normalized);

        const attemptedBlockedAction = 
          normalized.includes("edit ticket") ||
          normalized.includes("update customer details") ||
          normalized.includes("change registration status") ||
          normalized.includes("delete ticket") ||
          normalized.includes("modify previous record") ||
          normalized.includes("modify record") ||
          normalized.includes("change status") ||
          normalized.includes("update customer") ||
          normalized.includes("delete registration") ||
          normalized.includes("edit registration") ||
          normalized.includes("reassign ticket") ||
          normalized.includes("re-assign ticket") ||
          normalized.includes("delete lead") ||
          normalized.includes("edit lead") ||
          normalized.includes("edit customer") ||
          normalized.includes("reassign") ||
          normalized.includes("re-assign") ||
          normalized.includes("delete customer") ||
          normalized.includes("update ticket") ||
          normalized.includes("update details") ||
          normalized.includes("update status") ||
          normalized.includes("modify ticket") ||
          normalized.includes("modify customer") ||
          /\b(edit|delete|modify|reassign|re-assign)\b/.test(normalized);

        if (attemptedBlockedAction) {
          const deniedMessage = cleanVisibleAssistantText("Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator.");
          await saveChatMessage("assistant", deniedMessage, chatChannel);
          return res.json({ reply: deniedMessage });
        }

        if (isPendingLookup && userName) {
          const rawRequests = await db.select().from(serviceRequests)
            .orderBy(desc(serviceRequests.id))
            .limit(1000);
          const lowerUser = userName.toLowerCase().trim();
          const closedStatuses = new Set(["completed", "won", "lost", "duplicate", "deleted"]);
          const pendingRows = rawRequests.filter(r => {
            const salesPerson = (r.salesPerson || "").trim().toLowerCase();
            const reqPerson = (r.requestedPerson || "").trim().toLowerCase();
            const createdByVal = (r.createdBy || "").trim().toLowerCase();
            const status = (r.jobStatus || r.status || "").trim().toLowerCase();
            const belongsToStaff = salesPerson === lowerUser || reqPerson === lowerUser || createdByVal === lowerUser;
            return belongsToStaff && !closedStatuses.has(status);
          }).slice(0, 10);

          const pendingReply = cleanVisibleAssistantText(pendingRows.length === 0
            ? `${userName}, I do not see any pending or open requests assigned to you right now.`
            : formatStaffRecordList(`Pending/open requests for ${userName}`, pendingRows));

          await saveChatMessage("assistant", pendingReply, chatChannel);
          return res.json({ reply: pendingReply });
        }

        if (isLatestRecordsLookup && userName) {
          const countMatch = normalized.match(/\b(\d{1,2})\b/);
          const requestedCount = countMatch ? parseInt(countMatch[1], 10) : 10;
          const limitCount = Math.min(Math.max(requestedCount, 1), 25);
          const rawRequests = await db.select().from(serviceRequests)
            .orderBy(desc(serviceRequests.id))
            .limit(1000);
          const lowerUser = userName.toLowerCase().trim();
          const latestRows = rawRequests.filter(r => {
            const salesPerson = (r.salesPerson || "").trim().toLowerCase();
            const reqPerson = (r.requestedPerson || "").trim().toLowerCase();
            const createdByVal = (r.createdBy || "").trim().toLowerCase();
            return salesPerson === lowerUser || reqPerson === lowerUser || createdByVal === lowerUser;
          }).slice(0, limitCount);

          const latestReply = cleanVisibleAssistantText(latestRows.length === 0
            ? `${userName}, I do not see any records linked to your staff account right now.`
            : formatStaffRecordList(`Latest ${latestRows.length} records for ${userName}`, latestRows));

          await saveChatMessage("assistant", latestReply, chatChannel);
          return res.json({ reply: latestReply });
        }
      }

      // Fetch live DB Context dynamically filtered by user authorization limits
      let fetchedCustomers: any[] = [];
      let fetchedRequests: any[] = [];

      if (userRole === "admin") {
        fetchedCustomers = await db.select().from(customers).orderBy(desc(customers.id)).limit(40);
        fetchedRequests = await db.select().from(serviceRequests).orderBy(desc(serviceRequests.id)).limit(40);
      } else if (userRole === "staff" && userName) {
        // Fetch up to 1000 service requests first to filter
        const rawRequests = await db.select().from(serviceRequests)
          .orderBy(desc(serviceRequests.id))
          .limit(1000);

        const lowerUser = userName.toLowerCase().trim();
        fetchedRequests = rawRequests.filter(r => {
          const salesPerson = (r.salesPerson || "").trim().toLowerCase();
          const reqPerson = (r.requestedPerson || "").trim().toLowerCase();
          const createdByVal = (r.createdBy || "").trim().toLowerCase();
          return salesPerson === lowerUser || reqPerson === lowerUser || createdByVal === lowerUser;
        }).slice(0, 60);

        // Collect allowed customer name set
        const allowedCustomerNames = new Set(
          fetchedRequests.map(r => (r.customerName || "").trim().toLowerCase())
        );

        // Fetch/filter customers only where customer.name matches or customer.createdBy matches logged-in user
        const rawCustomers = await db.select().from(customers).orderBy(desc(customers.id)).limit(1000);
        fetchedCustomers = rawCustomers.filter(c => {
          const cName = (c.name || "").trim().toLowerCase();
          const cCreatedBy = (c.createdBy || "").trim().toLowerCase();
          return allowedCustomerNames.has(cName) || cCreatedBy === lowerUser;
        });
      } else if (userRole === "guest" && userName) {
        // Guest can retrieve ONLY records they created themselves
        const lowerUser = userName.toLowerCase().trim();
        fetchedCustomers = await db.select().from(customers)
          .where(eq(customers.createdBy, lowerUser))
          .orderBy(desc(customers.id))
          .limit(40);
          
        fetchedRequests = await db.select().from(serviceRequests)
          .where(eq(serviceRequests.createdBy, lowerUser))
          .orderBy(desc(serviceRequests.id))
          .limit(40);
      } else {
        fetchedCustomers = [];
        fetchedRequests = [];
      }

      // Extract unique alphanumeric keywords from the message to also search older records dynamically
      const keywords = message.toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w: string) => w.length >= 4 && !["what", "show", "list", "with", "this", "that", "please", "lead", "ticket", "status", "save", "update", "customer", "service", "active", "queue", "info", "record", "from"].includes(w));

      if (keywords.length > 0 && userRole !== "guest") {
        try {
          // Perform targeted searches to pull in older records if they are explicitly mentioned
          for (const word of keywords) {
            const extraCustomers = await db.select().from(customers).where(or(
              like(customers.name, `%${word}%`),
              like(customers.contactName, `%${word}%`)
            ));
            for (const c of extraCustomers) {
              if (userRole === "admin") {
                if (!fetchedCustomers.some(fc => fc.id === c.id)) {
                  fetchedCustomers.push(c);
                }
              } else if (userRole === "staff" && userName) {
                // Any extra customer found by keyword must still be allowed only if:
                // its name is in the staff user's allowed customer name set OR
                // customer.createdBy matches the logged-in user.
                const lowerUser = userName.toLowerCase().trim();
                const cName = (c.name || "").trim().toLowerCase();
                const cCreatedBy = (c.createdBy || "").trim().toLowerCase();
                const allowedCustomerNames = new Set(
                  fetchedRequests.map(r => (r.customerName || "").trim().toLowerCase())
                );
                if (allowedCustomerNames.has(cName) || cCreatedBy === lowerUser) {
                  if (!fetchedCustomers.some(fc => fc.id === c.id)) {
                    fetchedCustomers.push(c);
                  }
                }
              }
            }

            let extraRequests: any[] = [];
            if (userRole === "admin") {
              extraRequests = await db.select().from(serviceRequests).where(or(
                like(serviceRequests.customerName, `%${word}%`),
                like(serviceRequests.contactName, `%${word}%`),
                like(serviceRequests.issueDescription, `%${word}%`),
                like(serviceRequests.comment, `%${word}%`)
              ));
            } else if (userRole === "staff" && userName) {
              const rawExtra = await db.select().from(serviceRequests).where(or(
                like(serviceRequests.customerName, `%${word}%`),
                like(serviceRequests.contactName, `%${word}%`),
                like(serviceRequests.issueDescription, `%${word}%`),
                like(serviceRequests.comment, `%${word}%`)
              )).limit(500);
              const lowerUser = userName.toLowerCase().trim();
              extraRequests = rawExtra.filter(r => {
                const salesPerson = (r.salesPerson || "").trim().toLowerCase();
                const reqPerson = (r.requestedPerson || "").trim().toLowerCase();
                const createdByVal = (r.createdBy || "").trim().toLowerCase();
                return salesPerson === lowerUser || reqPerson === lowerUser || createdByVal === lowerUser;
              });
            }

            for (const r of extraRequests) {
              if (!fetchedRequests.some(fr => fr.id === r.id)) {
                fetchedRequests.push(r);
              }
            }
          }
        } catch (searchError) {
          console.error("Dynamic keyword DB search failed, continuing with cached subset:", (searchError as Error).message);
        }
      }

      // Map requests for lead registrations context description
      const allRegistrations = fetchedRequests.map(r => ({
        id: r.id,
        customerName: r.customerName || "",
        contactName: r.contactName || "",
        region: r.region || "",
        location: r.location || "",
        status: r.status || "New Lead"
      }));

      // Map requests for technical services context description
      const allServices = fetchedRequests.map(s => ({
        id: s.id,
        customerName: s.customerName || "",
        description: s.issueDescription || s.notes || s.comment || "",
        status: s.jobStatus || "Pending",
        assignee: s.salesPerson || s.requestedPerson || "Unassigned",
        location: s.location || "",
        amount: s.amount || ""
      }));

      const dbContextStr = `
CURRENT CRM DATABASE RECORDS:
 --- Customers ---
${fetchedCustomers.map((c: any) => ` * ID: ${c.id} | Name: "${c.name}" | Contact Person: "${c.contactName || ''}" | Phone: "${c.phone || ''}" | Region: "${c.region || ''}" | Vehicles count: ${c.vehicleCount || 0}`).join('\n')}

--- Lead Registrations ---
${allRegistrations.map((r: any) => ` * ID: ${r.id} | Customer: "${r.customerName}" | Contact Person: "${r.contactName || ''}" | Region: "${r.region || ''}" | Location: "${r.location || ''}" | Status: "${r.status || 'New Lead'}"`).join('\n')}

--- Active Service Queue ---
${allServices.map((s: any) => ` * ID: ${s.id} | Customer: "${s.customerName}" | Description: "${s.description || ''}" | Status: "${s.status || 'Ongoing'}" | Assignee: "${s.assignee || 'Unassigned'}" | Location: "${s.location || ''}" | Amount: "${s.amount || ''}"`).join('\n')}
`;

      // Dynamically load prompts to ensure any manual or UI updates to prompts.json are picked up in real-time
      let currentPrompts = { ...prompts };
      try {
        currentPrompts = loadPrompts();
      } catch (err) {
        console.error("Failed to load prompts dynamically, using in-memory defaults:", err);
      }

      const systemInstruction = buildChatSystemInstruction({
        prompts: currentPrompts,
        dbContextStr,
        userRole,
        userName,
        aiMode,
      });
      const localSystemInstruction = buildLocalLlmSystemInstruction(systemInstruction);

      const sanitizedChatHistory = () => sanitizeProviderChatHistory(chatHistory);

      const formatLocalCompareReply = (text: string): string => {
        const cleaned = applyStaffRequestedPersonDefault(formatCompareChatReply(text), userRole, userName);
        const templateDraft = formatServiceTemplateDraft(message);
        if (templateDraft) {
          return templateDraft;
        }
        return cleaned;
      };

      const runGeminiChatReply = async (): Promise<{ reply: string; durationMs: number; error?: string }> => {
        const startTime = Date.now();

        try {
          console.log(`[AI Chat] Mode=gemini, using ${cloudProviderLabel} with rich live DB context: model=${cleanedGeminiKey ? geminiModel : openRouterModel}`);
          const cleanedHistory = sanitizedChatHistory();

          let reply = "";
          if (genAI && cleanedGeminiKey) {
            reply = await runGeminiChatCompletion({
              genAI,
              model: geminiModel,
              systemInstruction,
              history: cleanedHistory,
              message,
            });
          } else {
            reply = await runOpenRouterChatCompletion({
              messages: [
                { role: "system", content: systemInstruction },
                ...cleanedHistory,
                { role: "user", content: message },
              ],
              temperature: 0.2,
              maxTokens: 1400,
            });
          }

          console.log(`[AI Chat] ${cloudProviderLabel} Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
          return {
            reply,
            durationMs: Date.now() - startTime,
          };
        } catch (providerErr) {
          console.error(`${cloudProviderLabel} API failed:`, (providerErr as Error).message);
          return {
            reply: "",
            durationMs: Date.now() - startTime,
            error: (providerErr as Error).message,
          };
        }
      };

      const runLocalChatReply = async (fallback = false): Promise<{ reply: string; durationMs: number; error?: string }> => {
        const startTime = Date.now();
        const deterministicQuery = detectQueryIntent(message);
        if (deterministicQuery && !actionIntents.has(deterministicQuery.intent)) {
          try {
            const result = await runDetectedSafeQuery(deterministicQuery, authUser, { role: userRole, name: userName });
            return {
              reply: result.answer,
              durationMs: Date.now() - startTime,
            };
          } catch (queryErr) {
            console.warn("Local deterministic query fallback failed:", (queryErr as Error).message);
          }
        }

        if (isSimpleGreetingMessage(message)) {
          return {
            reply: formatOperationalGreeting(userName, fetchedRequests),
            durationMs: Date.now() - startTime,
          };
        }

        try {
          const reply = await runLocalOllamaChatCompletion({
            localSystemInstruction,
            history: sanitizedChatHistory(),
            message,
            fallback,
          });

          console.log(`[AI Chat] Ollama Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
          return {
            reply,
            durationMs: Date.now() - startTime,
          };
        } catch (ollamaErr) {
          console.error("Ollama connection failed:", (ollamaErr as Error).message);
          return {
            reply: "I'm the SynoHub AI Assistant. I detected a temporary delay in my local processor. How can I help you manage your fleet today?",
            durationMs: Date.now() - startTime,
            error: (ollamaErr as Error).message,
          };
        }
      };

      const runExtraChatReply = async (): Promise<{ reply: string; durationMs: number; error?: string }> => {
        const startTime = Date.now();
        try {
          console.log(`[AI Chat] Mode=openrouter, using OpenRouter LLM: model=${extraLlmModel}, reasoning=${extraLlmReasoning}`);
          const cleanedHistory = sanitizedChatHistory();

          const reply = await runOpenRouterChatCompletion({
            model: extraLlmModel,
            reasoning: extraLlmReasoning,
            messages: [
              { role: "system", content: systemInstruction },
              ...cleanedHistory,
              { role: "user", content: message },
            ],
            temperature: 0.2,
            maxTokens: 1400,
          });

          return {
            reply,
            durationMs: Date.now() - startTime,
          };
        } catch (providerErr) {
          console.error("OpenRouter API failed:", (providerErr as Error).message);
          return {
            reply: "",
            durationMs: Date.now() - startTime,
            error: (providerErr as Error).message,
          };
        }
      };

      const runNvidiaChatReply = async (): Promise<{ reply: string; durationMs: number; error?: string }> => {
        const startTime = Date.now();
        try {
          console.log(`[AI Chat] Mode=nvidia, using ${openRouterPrimaryLabel}/OpenRouter: model=${openRouterModel}`);
          const cleanedHistory = sanitizedChatHistory();

          const reply = await runOpenRouterChatCompletion({
            model: openRouterModel,
            reasoning: true,
            reasoningStateKey: `${chatChannel}|${openRouterModel}`,
            messages: [
              { role: "system", content: systemInstruction },
              ...cleanedHistory,
              { role: "user", content: message },
            ],
            temperature: 0.2,
            maxTokens: 1400,
          });

          return {
            reply,
            durationMs: Date.now() - startTime,
          };
        } catch (providerErr) {
          const errorMessage = (providerErr as Error).message;
          if (isOpenRouterTemporaryAvailabilityError(errorMessage)) {
            console.warn(`${openRouterPrimaryLabel} is temporarily throttled through OpenRouter:`, errorMessage);
          } else {
            console.error(`${openRouterPrimaryLabel} API failed:`, errorMessage);
          }
          return {
            reply: "",
            durationMs: Date.now() - startTime,
            error: errorMessage,
          };
        }
      };

      const runSelectedChatProvider = (provider: QueryProviderName) => {
        if (provider === "gemini") return runGeminiChatReply();
        if (provider === "local") return runLocalChatReply();
        if (provider === "nvidia") return runNvidiaChatReply();
        return runExtraChatReply();
      };

      if (aiMode === "compare") {
        console.log(`[AI Chat] Mode=compare, running selected providers: ${compareProviders.join(", ")}.`);
        const compareResults = await Promise.all(compareProviders.map(async (provider) => {
          const result = await runSelectedChatProvider(provider);
          if (provider === "nvidia" && result.error && (isOpenRouterPolicyEndpointError(result.error) || isOpenRouterTemporaryAvailabilityError(result.error))) {
            const fallbackReason = isOpenRouterPolicyEndpointError(result.error)
              ? "current OpenRouter account/model policy"
              : "temporary OpenRouter throttling";
            console.warn(`${openRouterPrimaryLabel} is unavailable due to ${fallbackReason} in compare mode; using Local LLM fallback.`);
            const fallback = await runLocalChatReply(true);
            const fallbackNotice = [
              isOpenRouterPolicyEndpointError(result.error)
                ? `${openRouterPrimaryLabel} is unavailable for the current OpenRouter model/account policy.`
                : `${openRouterPrimaryLabel} is currently throttled or temporarily unavailable through OpenRouter.`,
              `Configured model: ${openRouterModel}`,
              "Local LLM fallback result:",
              "",
              fallback.reply,
            ].join("\n");

            return [provider, {
              ...fallback,
              reply: fallback.reply ? fallbackNotice : "",
              error: fallback.reply ? undefined : fallback.error || result.error,
            }] as const;
          }

          return [provider, result] as const;
        }));

        const finalReply = cleanVisibleAssistantText([
          "Compare Both result:",
          "",
          ...compareResults.flatMap(([provider, result]) => [
            `${getProviderLabel(provider)} (${result.durationMs}ms)`,
            result.error
              ? `Error: ${formatProviderError(provider, result.error)}${provider === "local" && result.reply ? `\n\n${formatLocalCompareReply(result.reply)}` : ""}`
              : provider === "local"
                ? formatLocalCompareReply(result.reply)
                : formatCompareChatReply(result.reply),
            "",
          ]),
        ].join("\n"));

        await saveChatMessage("assistant", finalReply, chatChannel);

        return res.json({
          reply: finalReply,
          providers: Object.fromEntries(compareResults),
          compareProviders,
        });
      }

      let reply = "";
      let usedLocalProvider = false;

      if (chatProviderMode === "gemini") {
        const geminiReply = await runGeminiChatReply();
        if (geminiReply.reply && !geminiReply.error) {
          reply = geminiReply.reply;
        } else {
          if (!cleanedGeminiKey && !cleanedOpenRouterKey) {
            console.warn("[AI Chat] Mode=gemini requested, but no cloud provider is configured. Falling back to Ollama/local LLM.");
          } else {
            console.error(`${cloudProviderLabel} API failed, falling back to Ollama:`, geminiReply.error);
          }
          reply = (await runLocalChatReply(true)).reply;
          usedLocalProvider = true;
        }
      } else if (chatProviderMode === "nvidia") {
        const nvidiaReply = await runNvidiaChatReply();
        if (nvidiaReply.reply && !nvidiaReply.error) {
          reply = nvidiaReply.reply;
        } else {
          console.error(`${openRouterPrimaryLabel} failed, falling back to Ollama:`, nvidiaReply.error);
          reply = (await runLocalChatReply(true)).reply;
          usedLocalProvider = true;
        }
      } else if (chatProviderMode === "openrouter") {
        const extraReply = await runExtraChatReply();
        if (extraReply.reply && !extraReply.error) {
          reply = extraReply.reply;
        } else {
          console.error("OpenRouter failed, falling back to Ollama:", extraReply.error);
          reply = (await runLocalChatReply(true)).reply;
          usedLocalProvider = true;
        }
      } else {
        console.log("[AI Chat] Mode=local, skipping cloud provider.");
        reply = (await runLocalChatReply()).reply;
        usedLocalProvider = true;
      }

      if (usedLocalProvider) {
        reply = applyStaffRequestedPersonDefault(cleanLocalChatReply(reply), userRole, userName);
      }

      const templateRecord = parseServiceTemplateRecord(message);
      if (templateRecord && !/\[{1,2}SAVE_RECORD:/s.test(reply)) {
        const templateDraft = formatServiceTemplateDraft(message);
        reply = `${templateDraft || "I extracted the service request details."}\n\n[[SAVE_RECORD:${JSON.stringify(templateRecord)}]]`;
      }

      // Process records using role & username permissions
      const savedResult = await handleAIRecordSave(reply, userRole, userName);

      let finalReply = savedResult.reply;
      if (prependAccessRestricted && !finalReply.startsWith("Access Restricted:")) {
        finalReply = "Access Restricted: You can only view records created by your account.\n\n" + finalReply;
      }
      finalReply = cleanVisibleAssistantText(finalReply);

      // Save assistant message partitioned by username
      await saveChatMessage("assistant", finalReply, chatChannel);
      
      return res.json({ reply: finalReply, savedRecord: savedResult.savedRecord });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get chat history
  app.get("/api/chat/history", requireAuth, async (req, res) => {
    try {
      const authUser = getAuthUser(req);
      const userRole = authUser.role;
      const userName = authUser.name.trim();
      const requestedAiMode = typeof req.query.aiMode === "string"
        ? normalizeQueryAiMode(req.query.aiMode, authUser)
        : null;
      const historyPredicateFor = (channel: string) => {
        return requestedAiMode
          ? chatHistoryPredicates(getModeScopedChatChannel(channel, requestedAiMode))
          : chatHistoryPredicates(channel);
      };

      let history;
      if (userRole === "admin") {
        // Admins can review a specific channel: admin, guest, or staff:<name>.
        const target = (req.query.target || req.query.username) as string | undefined;
        if (target) {
          const chatIdentity = resolveChatIdentity(authUser, target);
          history = await getChatMessagesByPredicate(historyPredicateFor(chatIdentity.channel));
        } else {
          history = await getChatMessagesByPredicate(historyPredicateFor("admin"));
        }
      } else {
        // Filter by username specifically
        const chatIdentity = resolveChatIdentity(authUser);
        history = await getChatMessagesByPredicate(historyPredicateFor(chatIdentity.channel));
      }
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Log Ingestion & Parsing ---

  app.post("/api/ingest", requireAuth, requireRoles("admin", "staff"), async (req, res) => {
    try {
      const { rawLog } = req.body;
      if (!rawLog) return res.status(400).json({ error: "Missing raw log" });

      // Split log into messages (simple regex for date/time pattern)
      const messages_raw = rawLog.split(/\n(?=\d{2}\/\d{2}\/\d{4},)/g);
      const batch = messages_raw.slice(0, 10).join("\n---\n"); // Process first 10 for demo speed

      // Dynamically load prompts to ensure any manual or UI updates to prompts.json are picked up in real-time
      let currentPrompts = { ...prompts };
      try {
        currentPrompts = loadPrompts();
      } catch (err) {
        console.error("Failed to load prompts dynamically in /api/ingest:", err);
      }

      let parsedSuccessfully = false;
      let rawResponseContent = "";

      // 1. Try Gemini first if available
      if (genAI && cleanedGeminiKey) {
        try {
          console.log(`[AI Ingest] Using Gemini API with log extractor prompt: model=${geminiModel}`);
          const startTime = Date.now();
          const response = await genAI.models.generateContent({
            model: geminiModel,
            contents: "Extract records from these logs:\n" + batch,
            config: {
              systemInstruction: currentPrompts.log_extractor,
              responseMimeType: "application/json"
            }
          });
          console.log(`[AI Ingest] Gemini Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
          rawResponseContent = response.text;
          parsedSuccessfully = true;
        } catch (geminiErr) {
          console.error("Gemini failed for log extraction, falling back to Ollama:", (geminiErr as Error).message);
        }
      }

      // 2. Use the primary OpenRouter provider only when Gemini is not configured
      if (!parsedSuccessfully && !cleanedGeminiKey && cleanedOpenRouterKey) {
        try {
          console.log(`[AI Ingest] Using ${openRouterPrimaryLabel}/OpenRouter log extractor: model=${openRouterModel}`);
          const startTime = Date.now();
          rawResponseContent = await runOpenRouterChatCompletion({
            json: true,
            maxTokens: 4000,
            temperature: 0,
            messages: [
              { role: "system", content: currentPrompts.log_extractor },
              { role: "user", content: "Extract records from these logs:\n" + batch },
            ],
          });
          console.log(`[AI Ingest] ${openRouterPrimaryLabel}/OpenRouter Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
          parsedSuccessfully = true;
        } catch (providerErr) {
          console.error(`${openRouterPrimaryLabel}/OpenRouter failed for log extraction, falling back to Ollama:`, (providerErr as Error).message);
        }
      }

      // 3. Fall back to Ollama if cloud providers failed or were unavailable
      if (!parsedSuccessfully) {
        let ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
        if (!ollamaUrl.endsWith("/api/chat")) {
          ollamaUrl = ollamaUrl.replace(/\/$/, "") + "/api/chat";
        }

        const ollamaOptions: any = {
          num_ctx: parseInt(process.env.OLLAMA_NUM_CTX || "2048"),
          num_thread: parseInt(process.env.OLLAMA_NUM_THREAD || "6"),
        };

        const gpuConfig = parseInt(process.env.OLLAMA_NUM_GPU || "-1");
        ollamaOptions.num_gpu = gpuConfig;
        
        if (gpuConfig !== -1) {
          ollamaOptions.main_gpu = 0;
        }

        const currentOllamaModel = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";

        console.log(`[AI Ingest] START: model=${currentOllamaModel}, options=${JSON.stringify(ollamaOptions)}`);
        console.log(`[AI Ingest] URL: ${ollamaUrl}`);
        const startTime = Date.now();

        const response = await axios.post(ollamaUrl, {
          model: currentOllamaModel,
          messages: [
            { role: "system", content: currentPrompts.log_extractor },
            { role: "user", content: "Extract records from these logs:\n" + batch }
          ],
          options: ollamaOptions,
          keep_alive: process.env.OLLAMA_KEEP_ALIVE || "5m",
          stream: false
        }, { 
          timeout: 300000,
          validateStatus: () => true 
        });

        if (response.status !== 200) {
          throw new Error(`Ollama returned status ${response.status}: ${JSON.stringify(response.data)}`);
        }

        console.log(`[AI Ingest] Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        rawResponseContent = response.data.message.content;
        parsedSuccessfully = true;
      }

      let content = rawResponseContent.replace(/```json|```/g, "").trim();
      const extracted = JSON.parse(content);
      res.json({ extracted });
    } catch (error) {
      console.error("Ingestion failed:", (error as Error).message);
      res.status(500).json({ error: "AI Parsing failed. Check Ollama connection.", details: (error as Error).message });
    }
  });

  // Bulk save ingested data
  app.post("/api/ingest/save", requireAuth, requireRoles("admin"), async (req, res) => {
    try {
      const { records } = req.body;
      for (const rec of records) {
        if (rec.type === "registration") {
          await db.insert(serviceRequests).values({
            customerName: rec.customerName,
            contactName: rec.contactName,
            phone: rec.phone,
            email: rec.email,
            region: rec.region,
            address: rec.address,
            mapLink: rec.mapLink,
            coordinates: rec.coordinates,
            source: rec.source,
            status: rec.status || 'New Lead',
            implementationType: rec.implementationType,
            salesPerson: rec.salesPerson,
            salesType: rec.salesType,
            requestedPerson: rec.requestedPerson,
            comment: rec.comment,
            projectValue: rec.projectValue,
            priceDetails: rec.priceDetails,
            accessories: rec.accessories,
            newQty: rec.newQty || rec.qty || 0,
            migrateQty: rec.migrateQty || 0,
            tradingQty: rec.tradingQty || 0,
            serviceQty: rec.serviceQty || 0,
            otherQty: rec.otherQty || 0
          });
        } else if (rec.type === "service") {
          await db.insert(serviceRequests).values({
            customerName: rec.customerName,
            issueDescription: rec.description,
            jobStatus: rec.status || 'Pending',
            newQty: rec.quantity || 1,
            requestedPerson: rec.requestedPerson,
            paymentStatus: rec.payment,
            amount: rec.amount,
            salesPerson: rec.assignee
          });
        }
      }
      res.json({ success: true, message: "Bulk import complete" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Vite & Static Handling ---

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server: httpServer,
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Check Ollama status
    try {
      const ollamaUrl = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
      const response = await axios.get(`${ollamaUrl}/api/tags`, { timeout: 5000 });
      console.log("Ollama connection: OK");
      console.log("Models available:", response.data.models?.map((m: any) => m.name).join(", "));
    } catch (err) {
      console.warn("Ollama connection: FAILED at startup.");
      console.warn("Error:", (err as Error).message);
      console.warn("AI features will fallback or return errors until Ollama is reachable at:", process.env.OLLAMA_URL);
    }
  });
}

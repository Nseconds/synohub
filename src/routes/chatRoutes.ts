import "dotenv/config";
import express from "express";
import { createServer as createHttpServer } from "http";
import path from "path";
import { createServer as createViteServer } from "vite";
import { db } from "../db";
import { initDB } from "../db/init";
import { customers, serviceRequests } from "../db/schema";
import { eq, like, or, desc } from "drizzle-orm";
import axios from "axios";
import env from "../shared/validation/env";

import { getAuthUser, requireAuth } from "../auth/middleware";
import { chatHistoryPredicates, resolveChatIdentity } from "../auth/permissions";
import { getChatMessagesByPredicate, getRecentChatMessages, saveChatMessage } from "../services/messageService";
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
} from "../ai/providerConfig";
import { runGeminiChatCompletion } from "../ai/providers/gemini";
import { runLocalOllamaChatCompletion } from "../ai/providers/localOllama";
import { answerRequestedPersonLookup } from "../ai/directLookupAnswers";
import {
  handleAIRecordSave,
  isAcknowledgementOnlyMessage,
  saveForcedServiceRequestFromMessage,
} from "../ai/recordSaveHandler";
import { buildChatSystemInstruction } from "../ai/prompts/buildPrompt";
import { buildLocalLlmSystemInstruction, loadPrompts } from "../ai/prompts/promptLoader";
import {
  formatServiceTemplateDraft,
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
  providerToDetected,
  validateQueryIntent,
  type DetectedQueryIntent,
  type QueryProviderResult,
} from "../ai/queryIntentDetector";
import {
  formatProviderError,
  getProviderLabel,
  isOpenRouterTemporaryAvailabilityError,
  runGeminiIntentProvider,
  runLocalIntentProvider,
  runNvidiaIntentProvider,
  runOpenRouterIntentProvider,
} from "../ai/intentProviders";
import {
  attachProviderAnswer,
  canonicalQueryParams,
  paramsMatch,
  runDetectedSafeQuery,
  safeQueryHandlers,
} from "../ai/safeQueryExecutor";
import {
  formatOperationalGreeting,
  isSimpleGreetingMessage,
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
import { registerAnalyticsRoutes } from "./analyticsRoutes";
import { registerAuthRoutes } from "./authRoutes";
import { registerCustomerRoutes } from "./customerRoutes";
import { registerDashboardRoutes } from "./dashboardRoutes";
import { registerServiceRequestRoutes } from "./serviceRequestRoutes";

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

function normalizeChatLookupText(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b(recrds|recrd|reocrds|recrods|recods)\b/g, "records")
    .replace(/\b(reqsts|reqs)\b/g, "requests")
    .trim();
}

function isIdentityLookupMessage(input: string): boolean {
  const normalized = normalizeChatLookupText(input);
  return /\b(who\s+am\s+i|who\s+i\s+am|what\s+is\s+my\s+(name|role)|my\s+login|my\s+account)\b/.test(normalized);
}

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

export async function startServer() {
  const app = express();
  const PORT = env.PORT;
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

  registerAuthRoutes(app);
  registerDashboardRoutes(app);
  registerServiceRequestRoutes(app);
  registerCustomerRoutes(app);
  registerAnalyticsRoutes(app);

  // Safe natural-language query endpoint. This route never asks AI to generate SQL.
  app.post("/api/chat/query", requireAuth, async (req, res) => {
    let detectedForError: DetectedQueryIntent | null = null;
    try {
      const authUser = getAuthUser(req);
      const queryUser = { role: authUser.role, name: authUser.name };
      const chatIdentity = resolveChatIdentity(authUser);
      const message = normalizeQueryText(req.body?.message || req.body?.question || req.body?.query);
      const requestedAiMode = normalizeQueryAiMode(req.body?.aiMode, authUser);
      const aiMode = requestedAiMode === "auto-fallback" ? "local" : requestedAiMode;
      const compareProviders = normalizeCompareProviders(req.body?.compareProviders);
      const chatChannel = getModeScopedChatChannel(chatIdentity.channel, aiMode);

      if (!message) {
        return res.status(400).json({ error: "Question is required." });
      }

      await saveChatMessage("user", message, chatChannel);

      const forcedServiceRequest = await saveForcedServiceRequestFromMessage(message, authUser, chatChannel);
      if (forcedServiceRequest) {
        const forcedReply = cleanVisibleAssistantText(forcedServiceRequest.answer);
        await saveChatMessage("assistant", forcedReply, chatChannel);

        return res.json({
          answer: forcedReply,
          reply: forcedReply,
          mode: aiMode,
          winner: "backend",
          intent: "createServiceRequest",
          requiresCustomerConfirmation: forcedServiceRequest.requiresCustomerConfirmation,
          possibleCustomers: forcedServiceRequest.possibleCustomers,
          customerMatched: forcedServiceRequest.customerMatched,
          customerCreated: forcedServiceRequest.customerCreated,
          customerId: forcedServiceRequest.customerId,
          serviceRequestId: forcedServiceRequest.serviceRequestId,
          salesplusSaved: forcedServiceRequest.salesplusSaved,
          extracted: forcedServiceRequest.fields,
          rows: [],
        });
      }

      const recentMessages = await getRecentChatMessages(chatChannel, 8);
      const requestedPersonAnswer = await answerRequestedPersonLookup(message, authUser, recentMessages);
      if (requestedPersonAnswer) {
        const answer = cleanVisibleAssistantText(requestedPersonAnswer);
        await saveChatMessage("assistant", answer, chatChannel);

        return res.json({
          answer,
          reply: answer,
          mode: aiMode,
          winner: "backend",
          intent: "getTicketsByCustomer",
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

      const forcedServiceRequest = await saveForcedServiceRequestFromMessage(message, authUser, chatChannel);
      if (forcedServiceRequest) {
        const reply = cleanVisibleAssistantText(forcedServiceRequest.answer);
        await saveChatMessage("assistant", reply, chatChannel);

        return res.json({
          reply,
          ...(forcedServiceRequest.serviceRequestId
            ? {
              savedRecord: {
                id: forcedServiceRequest.serviceRequestId,
                type: "service",
                customerId: forcedServiceRequest.customerId,
                customerMatched: forcedServiceRequest.customerMatched,
                customerCreated: forcedServiceRequest.customerCreated,
                salesplusSaved: forcedServiceRequest.salesplusSaved,
                ...forcedServiceRequest.fields,
              },
            }
            : {}),
          intent: "createServiceRequest",
          requiresCustomerConfirmation: forcedServiceRequest.requiresCustomerConfirmation,
          possibleCustomers: forcedServiceRequest.possibleCustomers,
          customerMatched: forcedServiceRequest.customerMatched,
          customerCreated: forcedServiceRequest.customerCreated,
          customerId: forcedServiceRequest.customerId,
          serviceRequestId: forcedServiceRequest.serviceRequestId,
          salesplusSaved: forcedServiceRequest.salesplusSaved,
          extracted: forcedServiceRequest.fields,
        });
      }

      const requestedPersonAnswer = await answerRequestedPersonLookup(message, authUser, persistedHistory);
      if (requestedPersonAnswer) {
        const reply = cleanVisibleAssistantText(requestedPersonAnswer);
        await saveChatMessage("assistant", reply, chatChannel);
        return res.json({
          reply,
          selectedProvider: "backend",
          intent: "requestedPersonLookup",
        });
      }

      if (isAcknowledgementOnlyMessage(message)) {
        const reply = cleanVisibleAssistantText("Okay.");
        await saveChatMessage("assistant", reply, chatChannel);
        return res.json({ reply });
      }

      if (isIdentityLookupMessage(message)) {
        const roleLabel = userRole ? userRole.charAt(0).toUpperCase() + userRole.slice(1) : "User";
        const reply = cleanVisibleAssistantText(userName
          ? `You are signed in as ${userName} (${roleLabel}).`
          : `You are signed in as ${roleLabel}.`);
        await saveChatMessage("assistant", reply, chatChannel);
        return res.json({ reply });
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
        const normalized = normalizeChatLookupText(message);
        const isPendingLookup =
          /\b(my\s+)?pending\s+(request|requests|ticket|tickets|lead|leads)\b/.test(normalized) ||
          /\b(open|ongoing|hold)\s+(request|requests|ticket|tickets|lead|leads)\b/.test(normalized) ||
          normalized === "pending request please" ||
          normalized === "pending requests please";
        const isLatestRecordsLookup =
          /\b(latest|last|recent)\s+(\d+\s+)?(record|records|request|requests|ticket|tickets|lead|leads)\b/.test(normalized) ||
          /\b(show|list|view)\s+(my\s+)?(latest|last|recent)\b/.test(normalized) ||
          /\b(get|show|list|view)\s+(my\s+)?(record|records|request|requests|ticket|tickets|lead|leads|job|jobs|task|tasks|work)\b/.test(normalized) ||
          /\bmy\s+(record|records|request|requests|ticket|tickets|lead|leads|job|jobs|task|tasks|work)\b/.test(normalized);

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
        status: r.status || "New Lead",
        createdAt: r.createdAt || ""
      }));

      // Map requests for technical services context description
      const allServices = fetchedRequests.map(s => ({
        id: s.id,
        customerName: s.customerName || "",
        description: s.issueDescription || s.notes || s.comment || "",
        status: s.jobStatus || "Pending",
        assignee: s.salesPerson || s.requestedPerson || "Unassigned",
        location: s.location || "",
        amount: s.amount || "",
        createdAt: s.createdAt || ""
      }));

      const currentDateLabel = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const dbContextStr = `
CURRENT DATE: ${currentDateLabel}
If the user asks for today, today's, or todays records, use only records whose Created value is ${currentDateLabel}. Do not treat description words like "tomorrow" as today's date.

CURRENT CRM DATABASE RECORDS:
 --- Customers ---
${fetchedCustomers.map((c: any) => ` * ID: ${c.id} | Name: "${c.name}" | Contact Person: "${c.contactName || ''}" | Phone: "${c.phone || ''}" | Region: "${c.region || ''}" | Vehicles count: ${c.vehicleCount || 0}`).join('\n')}

--- Lead Registrations ---
${allRegistrations.map((r: any) => ` * ID: ${r.id} | Created: "${r.createdAt || ''}" | Customer: "${r.customerName}" | Contact Person: "${r.contactName || ''}" | Region: "${r.region || ''}" | Location: "${r.location || ''}" | Status: "${r.status || 'New Lead'}"`).join('\n')}

--- Active Service Queue ---
${allServices.map((s: any) => ` * ID: ${s.id} | Created: "${s.createdAt || ''}" | Customer: "${s.customerName}" | Description: "${s.description || ''}" | Status: "${s.status || 'Ongoing'}" | Assignee: "${s.assignee || 'Unassigned'}" | Location: "${s.location || ''}" | Amount: "${s.amount || ''}"`).join('\n')}
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

      if (isSimpleGreetingMessage(message)) {
        const reply = cleanVisibleAssistantText(formatOperationalGreeting(userName, fetchedRequests));
        await saveChatMessage("assistant", reply, chatChannel);
        return res.json({ reply });
      }

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

      const runCompareChatReply = async (): Promise<{
        reply: string;
        providers: Record<string, { reply: string; durationMs: number; error?: string }>;
        compareProviders: QueryProviderName[];
        durationMs: number;
      }> => {
        const startTime = Date.now();
        console.log(`[AI Chat] Mode=compare, running selected providers: ${compareProviders.join(", ")}.`);
        const compareResults = await Promise.all(compareProviders.map(async (provider) => {
          const result = await runSelectedChatProvider(provider);
          return [provider, result] as const;
        }));

        const successfulResults = compareResults.filter(([, result]) => result.reply && !result.error);
        if (successfulResults.length === 0) {
          const errorSummary = compareResults
            .map(([provider, result]) => `${getProviderLabel(provider)}: ${result.error || "No reply produced."}`)
            .join(" | ");
          throw new Error(`Compare mode failed. ${errorSummary}`);
        }

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

        return {
          reply: finalReply,
          providers: Object.fromEntries(compareResults),
          compareProviders,
          durationMs: Date.now() - startTime,
        };
      };

      const formatAutoFallbackCompareReply = (compareResult: {
        reply: string;
        providers?: Record<string, { reply: string; durationMs: number; error?: string }>;
        compareProviders?: QueryProviderName[];
      }): string => {
        const providers = compareResult.providers || {};
        const orderedProviders = compareResult.compareProviders || compareProviders;
        const successful = orderedProviders
          .map(provider => [provider, providers[provider]] as const)
          .find(([, result]) => result?.reply && !result.error);

        if (!successful) return compareResult.reply;

        const [provider, result] = successful;
        return provider === "local"
          ? formatLocalCompareReply(result.reply)
          : formatCompareChatReply(result.reply);
      };

      if (aiMode === "compare") {
        const compareResult = await runCompareChatReply();
        await saveChatMessage("assistant", compareResult.reply, chatChannel);

        return res.json({
          reply: compareResult.reply,
          providers: compareResult.providers,
          compareProviders: compareResult.compareProviders,
        });
      }

      let reply = "";
      let usedLocalProvider = false;
      let selectedProvider: string | undefined;
      let fallbackUsed = false;
      let fallbackAttempts: Array<{ provider: string; error: string }> = [];

      const requireSuccessfulReply = (
        provider: string,
        result: { reply: string; durationMs: number; error?: string }
      ) => {
        if (result.reply && !result.error) return result;
        throw new Error(result.error || `${provider} returned no reply.`);
      };

      const callManualProvider = async () => {
        if (chatProviderMode === "gemini") {
          selectedProvider = "gemini";
          return requireSuccessfulReply("Gemini", await runGeminiChatReply());
        }
        if (chatProviderMode === "nvidia") {
          selectedProvider = "gpt-oss";
          return requireSuccessfulReply(openRouterPrimaryLabel, await runNvidiaChatReply());
        }
        if (chatProviderMode === "openrouter") {
          selectedProvider = "cohere";
          return requireSuccessfulReply("Cohere", await runExtraChatReply());
        }
        selectedProvider = "local";
        console.log("[AI Chat] Mode=local, skipping cloud provider.");
        const localResult = requireSuccessfulReply("Local LLM", await runLocalChatReply());
        usedLocalProvider = true;
        return localResult;
      };

      const callAiWithFallback = async () => {
        const fallbackSequence = [
          { key: "gemini", label: "Gemini", call: runGeminiChatReply },
          { key: "gpt-oss", label: openRouterPrimaryLabel, call: runNvidiaChatReply },
          { key: "cohere", label: "Cohere", call: runExtraChatReply },
          { key: "local", label: "Local LLM", call: () => runLocalChatReply(true) },
        ] as const;

        for (let index = 0; index < fallbackSequence.length; index += 1) {
          const attempt = fallbackSequence[index];
          try {
            const result = await attempt.call();
            if (!result.reply) {
              throw new Error(`${attempt.label} returned no reply.`);
            }
            selectedProvider = attempt.key;
            fallbackUsed = index > 0;
            usedLocalProvider = attempt.key === "local";
            return result;
          } catch (error) {
            const message = (error as Error).message;
            fallbackAttempts.push({ provider: attempt.key, error: message });
            console.warn(`[AI Chat] Auto Fallback attempt ${index + 1} failed: ${attempt.label}: ${message}`);
          }
        }

        throw new Error("All AI providers failed. Gemini, GPT OSS, Cohere, and Local LLM were unavailable. Please check API keys, network access, and Ollama status.");
      };

      if (aiMode === "auto-fallback") {
        const fallbackResult = await callAiWithFallback();
        reply = selectedProvider === "compare"
          ? formatAutoFallbackCompareReply(fallbackResult)
          : fallbackResult.reply;
        if (/^\s*Compare Both result:/i.test(reply)) {
          reply = formatAutoFallbackCompareReply(fallbackResult);
        }
      } else {
        const manualResult = await callManualProvider();
        reply = manualResult.reply;
      }

      if (usedLocalProvider) {
        reply = applyStaffRequestedPersonDefault(cleanLocalChatReply(reply), userRole, userName);
      }
      if (aiMode === "auto-fallback" && fallbackUsed && selectedProvider) {
        const providerLabel = selectedProvider === "gpt-oss"
          ? openRouterPrimaryLabel
          : selectedProvider === "cohere"
            ? "Cohere"
            : selectedProvider === "local"
              ? "Local LLM"
              : "Gemini";
        reply = `Answered using ${providerLabel} after earlier provider failure.\n\n${reply}`;
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
      
      return res.json({
        reply: finalReply,
        savedRecord: savedResult.savedRecord,
        ...(selectedProvider ? { selectedProvider } : {}),
        ...(aiMode === "auto-fallback" ? { fallbackUsed, fallbackAttemptCount: fallbackAttempts.length } : {}),
      });
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
      const ollamaUrl = env.OLLAMA_URL.replace(/\/$/, "");
      const response = await axios.get(`${ollamaUrl}/api/tags`, { timeout: 5000 });
      console.log("Ollama connection: OK");
      console.log("Models available:", response.data.models?.map((m: any) => m.name).join(", "));
    } catch (err) {
      console.warn("Ollama connection: FAILED at startup.");
      console.warn("Error:", (err as Error).message);
      console.warn("AI features will fallback or return errors until Ollama is reachable at:", env.OLLAMA_URL);
    }
  });
}

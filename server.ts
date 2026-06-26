import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { createServer as createHttpServer } from "http";
import path from "path";
import { createServer as createViteServer } from "vite";
import { db, pool } from "./src/db";
import { customers, serviceRequests, messages, salesplusEntries } from "./src/db/schema";
import { eq, like, or, desc, and } from "drizzle-orm";
import axios from "axios";
import crypto from "crypto";
import { execFile } from "child_process";
import mysql from "mysql2/promise";
import fs from "fs";

import { GoogleGenAI } from "@google/genai";
import queryRegistry, { applyRoleScope } from "./queryRegistry";

type UserRole = "admin" | "staff" | "guest";

interface AuthUser {
  sub: string;
  name: string;
  role: UserRole;
  iat: number;
  exp: number;
}

interface OpenRouterChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  reasoning_details?: unknown;
}

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
const openRouterReasoningMessages = new Map<string, Array<OpenRouterChatMessage>>();

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
const promptsPath = path.join(process.cwd(), "prompts.json");
const localLlmPromptPath = path.join(process.cwd(), "ai", "local-llm", "systemPrompt.txt");
const localLlmExamplesPath = path.join(process.cwd(), "ai", "local-llm", "styleExamples.json");
let prompts = {
  chat_assistant: "You are a SynoHub Assistant for Synosys, a fleet management SaaS company in the UAE. Assist users with CRM queries, service tickets, and registrations.",
  log_extractor: "You are a professional data extractor for Synosys Fleet CRM. Return ONLY a JSON array of extracted records."
};

try {
  if (fs.existsSync(promptsPath)) {
    const data = JSON.parse(fs.readFileSync(promptsPath, "utf8"));
    prompts = { ...prompts, ...data };
    console.log("Prompts loaded from prompts.json");
  }
} catch (err) {
  console.error("Failed to load prompts.json, using defaults.");
}

function readLocalLlmPrompt(): string {
  const fallback = [
    "You are SynoHub AI Assistant for Synosys Fleet Intelligence in Dubai.",
    "Answer as a concise fleet operations assistant, not a generic chatbot.",
    "For greetings, mention SynoHub, service tickets, locator registrations, customer records, and technician assignments.",
  ].join("\n");

  try {
    if (fs.existsSync(localLlmPromptPath)) {
      const content = fs.readFileSync(localLlmPromptPath, "utf8").trim();
      if (content) return content;
    }
  } catch (err) {
    console.error("Failed to load local LLM system prompt, using fallback:", err);
  }

  return fallback;
}

function readLocalLlmExamples(): string {
  try {
    if (!fs.existsSync(localLlmExamplesPath)) return "";
    const examples = JSON.parse(fs.readFileSync(localLlmExamplesPath, "utf8"));
    if (!Array.isArray(examples)) return "";

    const lines = examples
      .filter((item: any) => item && typeof item.input === "string" && typeof item.output === "string")
      .slice(0, 12)
      .map((item: any, index: number) => `Example ${index + 1} input:\n${item.input}\n\nExample ${index + 1} good reply:\n${item.output}`);

    return lines.length > 0
      ? `\n\nLOCAL LLM STYLE EXAMPLES:\n${lines.join("\n\n")}`
      : "";
  } catch (err) {
    console.error("Failed to load local LLM examples, continuing without examples:", err);
    return "";
  }
}

function buildLocalLlmSystemInstruction(sharedInstruction: string): string {
  return [
    sharedInstruction,
    "\n\nFINAL LOCAL LLM RESPONSE STYLE OVERRIDE:",
    readLocalLlmPrompt(),
    readLocalLlmExamples(),
  ].join("\n");
}

function extractTemplateField(input: string, labels: string[]): string {
  const templateFieldLabels = [
    "Customer Name", "Contact Person", "Contact Number", "Driver Number", "Driver Mobile", "Driver Phone",
    "Implementation Type", "Vehicle Plate", "Quantity", "Description", "accessories", "Service Location",
    "Preferred Date/Time", "Requested by", "Requested By", "Requested Person", "Amount",
    "Payment Status", "Payment", "Project Value", "Price", "Email", "E-mail", "Company Name",
    "Contact Name", "Phone", "Mobile", "Service Type", "Qty", "Plate", "Issue",
    "Location", "Region", "Accessories", "Preferred Date", "Date/Time"
  ];
  let normalizedInput = String(input || "")
    .replace(/[•·]/g, "\n")
    .replace(/([*━]+)\s*([A-Za-z][A-Za-z /-]{1,40})\s*:/g, "\n$2:")
    .replace(/\s+(SERVICE REQUEST|CUSTOMER DETAILS|SERVICE REQUIREMENT|SERVICE DETAILS|PAYMENT DETAILS)\b/gi, "\n$1");
  for (const label of templateFieldLabels) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    normalizedInput = normalizedInput.replace(new RegExp(`\\s+(${escapedLabel})\\s*:`, "gi"), "\n$1:");
  }
  for (const label of labels) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const linePattern = new RegExp(`^\\s*[*-]?\\s*${escapedLabel}\\s*:\\s*(.+?)\\s*$`, "im");
    const lineMatch = normalizedInput.match(linePattern);
    if (lineMatch?.[1]) {
      return lineMatch[1].replace(/[━*]+/g, " ").replace(/\s+/g, " ").trim();
    }
  }

  const escapedLabels = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const fieldLabels = templateFieldLabels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const sectionLabels = [
    "PAYMENT DETAILS", "SERVICE REQUIREMENT", "SERVICE DETAILS", "CUSTOMER DETAILS", "SERVICE REQUEST"
  ].map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  const pattern = new RegExp(
    `(?:^|[\\s*━-])\\s*(?:${escapedLabels.join("|")})\\s*:\\s*([\\s\\S]*?)(?=(?:\\s+[\\s*━-]*(?:${fieldLabels.join("|")})\\s*:)|(?:\\s+[\\s*━-]*(?:${sectionLabels.join("|")})\\b)|$)`,
    "i"
  );
  const match = normalizedInput.match(pattern);
  return match?.[1]
    ? match[1].replace(/[━*]+/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

function cleanTemplateValue(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[.,;]+$/, "")
    .trim();
}

function cleanCustomerTemplateName(value: string): string {
  const parts = String(value || "").split("|").map(part => cleanTemplateValue(part)).filter(Boolean);
  const raw = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || value);
  const cleaned = cleanTemplateValue(raw)
    .replace(/\bdetails\b$/i, "")
    .replace(/\b(services?|requirement|payment|customer)\s+details\b/i, "")
    .trim();
  if (/^al\s+ameen\s*sport$/i.test(cleaned.replace(/\s+/g, " "))) return "Al Ameen Sport";
  return cleaned;
}

function cleanContactTemplateName(value: string): string {
  const parts = String(value || "").split("|").map(part => cleanTemplateValue(part)).filter(Boolean);
  return parts.length > 1 ? parts[0] : cleanTemplateValue(value);
}

function isMissingTemplateValue(value: string): boolean {
  return !value || /^(n\/?a|na|none|null|-)?$/i.test(value.trim());
}

function parseServiceTemplateRecord(input: string): Record<string, any> | null {
  if (!/\bSERVICE REQUEST\b/i.test(input)) return null;

  const serviceType = cleanTemplateValue(extractTemplateField(input, ["Implementation Type"]));
  const customerName = cleanCustomerTemplateName(extractTemplateField(input, ["Customer Name"]));
  const contactName = cleanContactTemplateName(extractTemplateField(input, ["Contact Person", "Contact Name"]));
  const phone = cleanTemplateValue(extractTemplateField(input, ["Contact Number"]));
  const quantity = parseInt(cleanTemplateValue(extractTemplateField(input, ["Quantity"])) || "1", 10);
  const amountRaw = cleanTemplateValue(extractTemplateField(input, ["Amount"]));
  const amount = !amountRaw || /^n\/?a$/i.test(amountRaw) ? "0.00" : amountRaw;
  const location = cleanTemplateValue(extractTemplateField(input, ["Service Location", "Location"]));
  const requestedPerson = cleanTemplateValue(extractTemplateField(input, ["Requested by", "Requested By", "Requested Person"]));
  const rawDescription = cleanTemplateValue(extractTemplateField(input, ["Description"])) || "Service";
  const vehiclePlate = cleanTemplateValue(extractTemplateField(input, ["Vehicle Plate"]));
  const description = vehiclePlate && !isMissingTemplateValue(vehiclePlate)
    ? `${rawDescription} (Vehicle Plate: ${vehiclePlate})`
    : rawDescription;

  if (
    isMissingTemplateValue(serviceType) ||
    isMissingTemplateValue(customerName) ||
    isMissingTemplateValue(phone) ||
    isMissingTemplateValue(location) ||
    isMissingTemplateValue(requestedPerson)
  ) {
    return null;
  }

  return {
    type: "registration",
    customerName,
    contactName,
    phone,
    email: "",
    region: location,
    implementationType: serviceType.toUpperCase(),
    status: "New Lead",
    salesType: "New",
    requestedPerson,
    comment: description,
    newQty: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    projectValue: amount,
    priceDetails: amount,
    paymentStatus: amount === "0.00" ? "Not Applicable" : "Pending",
    amount,
  };
}

function formatServiceTemplateDraft(input: string): string | null {
  if (!/\bSERVICE REQUEST\b/i.test(input)) return null;

  const serviceType = cleanTemplateValue(extractTemplateField(input, ["Implementation Type"])) || "N/A";
  const customerName = cleanCustomerTemplateName(extractTemplateField(input, ["Customer Name"])) || "N/A";
  const contactName = cleanContactTemplateName(extractTemplateField(input, ["Contact Person", "Contact Name"])) || "N/A";
  const phone = cleanTemplateValue(extractTemplateField(input, ["Contact Number"])) || "N/A";
  const quantity = cleanTemplateValue(extractTemplateField(input, ["Quantity"])) || "1";
  const amountRaw = cleanTemplateValue(extractTemplateField(input, ["Amount"]));
  const amount = !amountRaw || /^n\/?a$/i.test(amountRaw) ? "0.00" : amountRaw;
  const payment = amount === "0.00" ? "Not Applicable" : "Pending";
  const location = cleanTemplateValue(extractTemplateField(input, ["Service Location", "Location"])) || "N/A";
  const requestedPerson = cleanTemplateValue(extractTemplateField(input, ["Requested by", "Requested By", "Requested Person"])) || "N/A";
  const rawDescription = cleanTemplateValue(extractTemplateField(input, ["Description"])) || "Service";
  const vehiclePlate = cleanTemplateValue(extractTemplateField(input, ["Vehicle Plate"]));
  const description = vehiclePlate && vehiclePlate !== "N/A"
    ? `${rawDescription} (Vehicle Plate: ${vehiclePlate})`
    : rawDescription;

  return [
    "Extracted service request details:",
    "",
    `Service Type       : ${serviceType.toUpperCase()}`,
    `Customer Name      : ${customerName}`,
    `Contact Name       : ${contactName}`,
    `Contact Number     : ${phone}`,
    `Quantity           : ${quantity}`,
    `Payment            : ${payment}`,
    `Amount             : ${amount}`,
    `Location           : ${location}`,
    `Requested Person   : ${requestedPerson}`,
    "Status             : New Lead",
    `Description        : ${description}`,
  ].join("\n");
}

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

function cleanVisibleAssistantText(text: string): string {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface ForcedServiceRequestFields {
  customerName: string;
  contactName: string;
  phone: string;
  email: string;
  driverNumber: string;
  implementationType: string;
  vehiclePlate: string;
  quantity: number;
  issueDescription: string;
  accessories: string;
  location: string;
  preferredDateTime: string;
  requestedPerson: string;
  amount: string;
  paymentStatus: string;
}

interface ForcedServiceRequestResult {
  answer: string;
  customerMatched: boolean;
  customerCreated: boolean;
  customerId: number;
  serviceRequestId: number;
  salesplusSaved: boolean;
  fields: ForcedServiceRequestFields;
}

function normalizeComparablePhone(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

function canonicalizeLocation(value: string): string {
  const cleaned = cleanTemplateValue(value);
  if (!cleaned) return "";
  return cleaned.replace(/\b(dubai|abu dhabi|sharjah|ajman|fujairah|ras al khaimah|umm al quwain)\b/gi, (match) => {
    return match
      .toLowerCase()
      .split(" ")
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  });
}

function isStrongServiceRequestText(input: string): boolean {
  const markers = [
    /\bSERVICE\s+REQUEST\b/i,
    /\bCUSTOMER\s+DETAILS\b/i,
    /\bSERVICE\s+REQUIREMENT\b/i,
    /\bPAYMENT\s+DETAILS\b/i,
    /\bImplementation\s+Type\s*:/i,
    /\bVehicle\s+Plate\s*:/i,
    /\bQuantity\s*:/i,
    /\bRequested\s+by\s*:/i,
    /\bRequested\s+Person\s*:/i,
    /\bService\s+Location\s*:/i,
    /\bContact\s+Number\s*:/i,
  ];
  if (!markers.some(marker => marker.test(input))) return false;

  const customerName = cleanCustomerTemplateName(extractTemplateField(input, ["Customer Name", "Company Name", "Customer"]));
  const phone = cleanTemplateValue(extractTemplateField(input, ["Contact Number", "Phone", "Mobile"])) || extractPhone(input) || "";
  return !isMissingTemplateValue(customerName) || !isMissingTemplateValue(phone);
}

function parseForcedServiceRequest(input: string): ForcedServiceRequestFields | null {
  if (!isStrongServiceRequestText(input)) return null;

  const customerName = cleanCustomerTemplateName(extractTemplateField(input, ["Customer Name", "Company Name", "Customer"]));
  const phone = cleanTemplateValue(extractTemplateField(input, ["Contact Number", "Phone", "Mobile"])) || extractPhone(input) || "";
  if (isMissingTemplateValue(customerName) && isMissingTemplateValue(phone)) return null;

  const amountRaw = cleanTemplateValue(extractTemplateField(input, ["Amount", "Project Value", "Price"]));
  const amount = !amountRaw || /^n\/?a$/i.test(amountRaw) ? "0.00" : amountRaw;
  const paymentStatusRaw = cleanTemplateValue(extractTemplateField(input, ["Payment Status", "Payment"]));
  const implementationType = cleanTemplateValue(extractTemplateField(input, ["Implementation Type", "Service Type"])) || "Service";
  const quantity = parseIntSafe(cleanTemplateValue(extractTemplateField(input, ["Quantity", "Qty"])), 1);
  const vehiclePlate = cleanTemplateValue(extractTemplateField(input, ["Vehicle Plate", "Plate"]));
  const issueDescription = cleanTemplateValue(extractTemplateField(input, ["Description", "Issue", "Service Requirement"])) || implementationType;
  const location = canonicalizeLocation(extractTemplateField(input, ["Service Location", "Location", "Region"]));

  return {
    customerName: customerName || "Unknown",
    contactName: cleanContactTemplateName(extractTemplateField(input, ["Contact Person", "Contact Name"])) || "",
    phone: cleanTemplateValue(phone),
    email: extractEmail(input) || cleanTemplateValue(extractTemplateField(input, ["Email", "E-mail"])) || "",
    driverNumber: cleanTemplateValue(extractTemplateField(input, ["Driver Number", "Driver Mobile", "Driver Phone"])) || "",
    implementationType,
    vehiclePlate,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    issueDescription,
    accessories: cleanTemplateValue(extractTemplateField(input, ["accessories", "Accessories"])) || "",
    location,
    preferredDateTime: cleanTemplateValue(extractTemplateField(input, ["Preferred Date/Time", "Preferred Date", "Date/Time"])) || "",
    requestedPerson: cleanTemplateValue(extractTemplateField(input, ["Requested by", "Requested By", "Requested Person"])) || "",
    amount,
    paymentStatus: paymentStatusRaw || (amount === "0.00" ? "Not Applicable" : "Pending"),
  };
}

const staffRoster = [
  "Ajmal", "Amrutha", "Athul", "Celine", "Deepak", "Faizal", "Ivy", "Midhun",
  "Mohamed Musthafa", "Naseeb", "Nishad", "Rasick", "Reyn", "Shamnad", "Shams", "Shyamjith"
];

const allowedStaff = staffRoster.map(name => name.toLowerCase());
const authSecret = cleanEnvVar(process.env.AUTH_SECRET || process.env.JWT_SECRET) || crypto.randomBytes(32).toString("hex");
const configuredAdminPassword = cleanEnvVar(process.env.ADMIN_PASSWORD) || "admin";
const configuredStaffPassword = cleanEnvVar(process.env.STAFF_PASSWORD) || "staff123";
const devAdminPassword = null;

if (!process.env.AUTH_SECRET && !process.env.JWT_SECRET) {
  console.warn("AUTH_SECRET is not set. Tokens will be invalidated on every server restart.");
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payload: string): string {
  return crypto.createHmac("sha256", authSecret).update(payload).digest("base64url");
}

function issueToken(user: Pick<AuthUser, "sub" | "name" | "role">): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthUser = {
    ...user,
    iat: now,
    exp: now + 60 * 60 * 12,
  };
  const encodedPayload = base64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

function verifyToken(token: string | undefined): AuthUser | null {
  if (!token || !token.includes(".")) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signPayload(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as AuthUser;
    if (!parsed.name || !parsed.role || !parsed.sub || !parsed.exp) return null;
    if (!["admin", "staff", "guest"].includes(parsed.role)) return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function getBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = verifyToken(getBearerToken(req));
  if (!user) {
    return res.status(401).json({ error: "Unauthorized. Please sign in again." });
  }
  (req as any).user = user;
  return next();
}

function requireRoles(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as AuthUser | undefined;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: "Forbidden. Your account does not have access to this action." });
    }
    return next();
  };
}

function getAuthUser(req: Request): AuthUser {
  return (req as any).user as AuthUser;
}

function normalizeUserName(name: string): string {
  return name.trim().toLowerCase();
}

function resolveChatIdentity(authUser: AuthUser, requestedTarget?: unknown) {
  const normalizedGuestName = normalizeUserName(authUser.name);
  const fallback = {
    role: authUser.role,
    name: authUser.role === "guest" ? normalizedGuestName : authUser.name.trim(),
    channel: authUser.role === "admin"
      ? "admin"
      : authUser.role === "staff"
        ? `staff:${authUser.name.trim()}`
        : `guest:${normalizedGuestName}`,
  };

  if (authUser.role !== "admin" || typeof requestedTarget !== "string") {
    return fallback;
  }

  const target = requestedTarget.trim();
  if (target === "admin") {
    return { role: "admin" as const, name: authUser.name.trim(), channel: "admin" };
  }

  if (target === "guest") {
    return { role: "guest" as const, name: "guest", channel: "guest" };
  }

  if (target.toLowerCase().startsWith("staff:")) {
    const rawStaffName = target.slice("staff:".length).trim();
    const matchedStaff = staffRoster.find(s => s.toLowerCase() === rawStaffName.toLowerCase());
    const staffName = matchedStaff || rawStaffName;
    if (staffName) {
      return { role: "staff" as const, name: staffName, channel: `staff:${staffName}` };
    }
  }

  return fallback;
}

function chatHistoryPredicates(channel: string) {
  if (channel.includes("|ai:")) {
    return eq(messages.username, channel);
  }

  const legacyModeChannels = [
    `${channel}|ai:local`,
    `${channel}|ai:gemini`,
    `${channel}|ai:compare`,
  ];

  if (channel.startsWith("staff:")) {
    const staffName = channel.slice("staff:".length);
    return or(
      eq(messages.username, channel),
      eq(messages.username, staffName),
      ...legacyModeChannels.map(legacyChannel => eq(messages.username, legacyChannel)),
    );
  }
  if (channel === "admin") {
    return or(
      eq(messages.username, "admin"),
      eq(messages.username, "Administrator"),
      ...legacyModeChannels.map(legacyChannel => eq(messages.username, legacyChannel)),
    );
  }
  if (channel === "guest") {
    return or(
      eq(messages.username, "guest"),
      like(messages.username, "guest:%"),
      ...legacyModeChannels.map(legacyChannel => eq(messages.username, legacyChannel)),
    );
  }
  if (channel.startsWith("guest:")) {
    return or(
      eq(messages.username, channel),
      ...legacyModeChannels.map(legacyChannel => eq(messages.username, legacyChannel)),
    );
  }
  return or(
    eq(messages.username, channel),
    ...legacyModeChannels.map(legacyChannel => eq(messages.username, legacyChannel)),
  );
}

function getModeScopedChatChannel(channel: string, aiMode: SafeQueryAiMode): string {
  return `${channel}|ai:${aiMode}`;
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

type SafeQueryIntent =
  | "assignTicket"
  | "reassignTicket"
  | "updateTicketStatus"
  | "deleteTicket"
  | "cancelTicket"
  | "createLead"
  | "createServiceRequest"
  | "createMigrationTicket"
  | "createInstallationTicket"
  | "findCustomerByName"
  | "findCustomerByPhone"
  | "findCustomerByEmail"
  | "getPendingTicketsByStaff"
  | "getOpenTicketsByRegion"
  | "getTicketsByStaff"
  | "getTicketsByRegion"
  | "getTicketsByServiceType"
  | "getPendingTickets"
  | "getOpenTickets"
  | "getCompletedTickets"
  | "getTicketById"
  | "getTicketsByStatusLabel"
  | "getCompletedTicketsThisWeek"
  | "getTicketsNeedingAttention"
  | "getTicketsByCustomer"
  | "getOpenTicketsByCustomer"
  | "getTicketsByIssue"
  | "getUnassignedTickets"
  | "getMostCommonIssues"
  | "getCustomerWithMostRequests"
  | "getCustomerHistory"
  | "getCustomerFleetSize"
  | "getCustomerRegion"
  | "getTechnicianWorkload"
  | "getHighestWorkload"
  | "getLowestWorkload"
  | "getStaffPerformance"
  | "getDuplicateRequests"
  | "getLatestRequests"
  | "getDashboardSummary"
  | "getRegionSummary"
  | "getStatusSummary"
  | "getDailySummary"
  | "getMonthlySummary"
  | "getStaffChatHistory"
  | "getGuestChatHistory";

interface DetectedQueryIntent {
  intent: SafeQueryIntent;
  params: Record<string, any>;
  confidence: number;
}

type SafeQueryAiMode = "gemini" | "local" | "compare" | "nvidia" | "openrouter";
type QueryProviderName = "gemini" | "local" | "nvidia" | "openrouter";

interface QueryProviderResult {
  intent?: SafeQueryIntent;
  params?: Record<string, any>;
  confidence?: number;
  durationMs: number;
  error?: string;
  answer?: string;
  rowCount?: number;
}

const actionIntents = new Set<SafeQueryIntent>([
  "assignTicket",
  "reassignTicket",
  "updateTicketStatus",
  "deleteTicket",
  "cancelTicket",
  "createLead",
  "createServiceRequest",
  "createMigrationTicket",
  "createInstallationTicket",
]);

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

const regionAliases: Record<string, string> = {
  "auh": "Abu Dhabi",
  "ad": "Abu Dhabi",
  "abu dhabi": "Abu Dhabi",
  "dxb": "Dubai",
  "dubai": "Dubai",
  "shj": "Sharjah",
  "sharjah": "Sharjah",
  "ajman": "Ajman",
  "fujairah": "Fujairah",
  "rak": "Ras Al Khaimah",
  "ras al khaimah": "Ras Al Khaimah",
  "uaq": "Umm Al Quwain",
  "umm al quwain": "Umm Al Quwain",
};

const intentMappings: Array<{ intent: SafeQueryIntent; examples: string[] }> = [
  { intent: "assignTicket", examples: ["assign ticket 12 to athul", "assign more work to deepak", "give ticket to shamnad"] },
  { intent: "reassignTicket", examples: ["reassign ticket 3 from faizal to nishad", "re-assign ticket 6 to reyn", "move ticket to celine"] },
  { intent: "updateTicketStatus", examples: ["update ticket 5 to completed", "mark ticket 14 as hold", "change status of ticket 8 to proposed"] },
  { intent: "deleteTicket", examples: ["delete ticket 15", "remove ticket 15", "delete service request"] },
  { intent: "cancelTicket", examples: ["cancel ticket 9", "cancel service request", "cancel job"] },
  { intent: "createLead", examples: ["new lead for arkan aldar", "create lead for customer", "add customer registration"] },
  { intent: "createServiceRequest", examples: ["create new service request", "create service ticket for kleemol", "add service request"] },
  { intent: "createMigrationTicket", examples: ["create migration ticket", "new migration request", "add migrate job"] },
  { intent: "createInstallationTicket", examples: ["create installation ticket", "new installation request", "add install job"] },
  { intent: "findCustomerByName", examples: ["find customer arkan", "search customer by name", "customer named arkan", "show account arkan"] },
  { intent: "findCustomerByPhone", examples: ["find customer by phone", "search phone 050", "who has phone number", "customer mobile number"] },
  { intent: "findCustomerByEmail", examples: ["find customer by email", "search email", "customer email address", "account with email"] },
  { intent: "getCustomerHistory", examples: ["customer history for arkan", "history of arkan", "recent requests by arkan", "customer activity for arkan"] },
  { intent: "getCustomerFleetSize", examples: ["fleet size for arkan", "vehicle count for customer", "how many vehicles for arkan", "customer units count"] },
  { intent: "getCustomerRegion", examples: ["customer region for arkan", "where is arkan located", "which region is customer", "customer emirate"] },
  { intent: "getPendingTickets", examples: ["show pending tickets", "pending requests", "list pending leads", "view pending service requests"] },
  { intent: "getOpenTickets", examples: ["show open tickets", "active tickets", "ongoing requests", "unresolved service queue"] },
  { intent: "getCompletedTickets", examples: ["show completed tickets", "completed requests", "won tickets", "closed service requests"] },
  { intent: "getCompletedTicketsThisWeek", examples: ["show all completed tickets this week", "completed tickets this week", "closed requests this week"] },
  { intent: "getTicketById", examples: ["find ticket number 7", "find ticket id 18", "show ticket 12"] },
  { intent: "getTicketsByStatusLabel", examples: ["show all new lead tickets", "show hold tickets", "show proposed tickets"] },
  { intent: "getTicketsNeedingAttention", examples: ["what tickets need attention", "tickets requiring attention", "urgent service issues"] },
  { intent: "getLatestRequests", examples: ["latest 10 records", "recent tickets", "last 20 requests", "latest leads"] },
  { intent: "getPendingTicketsByStaff", examples: ["show athul pending tickets", "athul open requests", "pending tickets for celine", "nishad active leads"] },
  { intent: "getTicketsByStaff", examples: ["show athul tickets", "records for celine", "requests by nishad", "staff tickets for faiza"] },
  { intent: "getOpenTicketsByRegion", examples: ["show dubai open tickets", "abu dhabi active requests", "open tickets in sharjah", "ongoing leads in ajman"] },
  { intent: "getTicketsByRegion", examples: ["dubai tickets", "records in abu dhabi", "sharjah requests", "leads by region"] },
  { intent: "getTicketsByServiceType", examples: ["how many migrations are there", "show migration jobs", "migration tickets", "list migrate requests"] },
  { intent: "getTechnicianWorkload", examples: ["staff workload", "technician workload", "workload by technician", "team workload"] },
  { intent: "getHighestWorkload", examples: ["highest workload", "busiest technician", "who has most tickets", "most loaded staff"] },
  { intent: "getLowestWorkload", examples: ["lowest workload", "least busy technician", "who has least tickets", "available staff"] },
  { intent: "getStaffPerformance", examples: ["staff performance", "technician performance", "completed by staff", "team performance summary"] },
  { intent: "getDuplicateRequests", examples: ["duplicate requests", "duplicate tickets", "find duplicate leads", "repeated customer issues"] },
  { intent: "getDashboardSummary", examples: ["dashboard summary", "operations summary", "system snapshot", "crm summary"] },
  { intent: "getRegionSummary", examples: ["region summary", "summary by region", "emirate summary", "regional workload"] },
  { intent: "getStatusSummary", examples: ["status summary", "summary by status", "ticket status count", "lead status breakdown"] },
  { intent: "getDailySummary", examples: ["daily summary", "today summary", "daily operations", "last 7 days summary"] },
  { intent: "getMonthlySummary", examples: ["monthly summary", "this month summary", "monthly operations", "last 12 months summary"] },
  { intent: "getStaffChatHistory", examples: ["staff chat history", "show athul chat", "staff conversation history", "messages for celine"] },
  { intent: "getGuestChatHistory", examples: ["guest chat history", "guest messages", "public chat history", "guest conversation"] },
];

const queryValidationRules = {
  minCustomerSearchLength: 2,
  maxCustomerSearchLength: 160,
  maxLimit: 50,
  forbiddenForGuest: [
    "getTechnicianWorkload",
    "getHighestWorkload",
    "getLowestWorkload",
    "getStaffPerformance",
    "getDuplicateRequests",
    "getDashboardSummary",
    "getRegionSummary",
    "getStatusSummary",
    "getDailySummary",
    "getMonthlySummary",
    "getStaffChatHistory",
  ] as SafeQueryIntent[],
};

function normalizeQueryText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIntentText(value: unknown): string {
  return normalizeQueryText(value)
    .toLowerCase()
    .replace(/\b(pednig|pendng|pendig|penidng|pendign|pendingg)\b/g, "pending")
    .replace(/\b(reocrds|recrods|recods)\b/g, "records")
    .replace(/\b(acount|accout|accoount)\b/g, "account")
}

function extractQueryLimit(text: string, fallback = 10): number {
  const match = text.toLowerCase().match(/\b(\d{1,3})\b/);
  const parsed = match ? parseInt(match[1], 10) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, 50));
}

function extractDateRange(text: string): "today" | "this_week" | "this_month" | undefined {
  const normalized = text.toLowerCase();
  if (/\b(today|today's)\b/.test(normalized)) return "today";
  if (/\b(this\s+week|week|weekly)\b/.test(normalized)) return "this_week";
  if (/\b(this\s+month|month|monthly)\b/.test(normalized)) return "this_month";
  return undefined;
}

function isCountOnlyQuestion(text: string): boolean {
  return /\b(how\s+many|count|total\s+(number|count)?)\b/i.test(text);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractStaffName(text: string): string | null {
  const normalized = text.toLowerCase();
  const matched = staffRoster.find(name => {
    return new RegExp(`\\b${escapeRegex(name.toLowerCase())}\\b`).test(normalized);
  });
  return matched || null;
}

function extractRegionName(text: string): string | null {
  const normalized = text.toLowerCase();
  const aliases = Object.entries(regionAliases).sort((a, b) => b[0].length - a[0].length);
  const matched = aliases.find(([alias]) => {
    return new RegExp(`\\b${escapeRegex(alias)}\\b`).test(normalized);
  });
  return matched ? matched[1] : null;
}

function extractEmail(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].trim() : null;
}

function extractPhone(text: string): string | null {
  const match = text.match(/(?:\+?\d[\d\s().-]{5,}\d)/);
  if (!match) return null;
  const phone = match[0].replace(/[^\d+]/g, "");
  return phone.length >= 6 ? phone : null;
}

function extractTicketId(text: string): number | null {
  const match = text.match(/\b(?:ticket|tickets|request|requests|id|number|#)\s*(?:id|number|no\.?)?\s*#?\s*(\d{1,10})\b/i);
  if (!match?.[1]) return null;
  const ticketId = parseInt(match[1], 10);
  return Number.isFinite(ticketId) && ticketId > 0 ? ticketId : null;
}

function extractStatusValue(text: string): string | null {
  const normalized = text.toLowerCase();
  const statusAliases: Array<[RegExp, string]> = [
    [/\bcompleted\b|\bcomplete\b|\bclosed\b|\bsolved\b/i, "Completed"],
    [/\bproposed\b|\bproposal\b/i, "Proposed"],
    [/\bhold\b|\bon hold\b/i, "Hold"],
    [/\bwon\b/i, "Won"],
    [/\bnew lead\b/i, "New Lead"],
    [/\bpending\b/i, "Pending"],
    [/\blost\b/i, "Lost"],
    [/\bduplicate\b/i, "Duplicate"],
    [/\bdeleted\b/i, "Deleted"],
  ];
  const matched = statusAliases.find(([pattern]) => pattern.test(normalized));
  return matched ? matched[1] : null;
}

function extractCreateCustomerName(text: string): string | null {
  const patterns = [
    /^new\s+lead\s+for\s+(.+?)(?:\s+contact\b|\s+(?:dubai|abu dhabi|sharjah|ajman|fujairah|rak|ras al khaimah|uaq|umm al quwain)\b|\s+(?:locator|migration|installation|service)\b|$)/i,
    /\bcreate\s+(?:new\s+)?(?:service\s+)?(?:ticket|request)\s+for\s+(.+?)(?:\s+(?:migration|installation|locator|service)\b|$)/i,
    /\bcreate\s+(?:new\s+)?(?:lead|customer)\s+for\s+(.+?)(?:\s+contact\b|\s+(?:dubai|abu dhabi|sharjah|ajman|fujairah|rak|ras al khaimah|uaq|umm al quwain)\b|\s+(?:locator|migration|installation|service)\b|$)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const customerName = match[1].trim().replace(/[.,:;?!]+$/, "");
      if (customerName) return customerName;
    }
  }
  return null;
}

function detectActionIntent(text: string): DetectedQueryIntent | null {
  const normalized = text.toLowerCase().trim();
  const isReadCommand = /\b(show|list|view|find|get|search)\b/.test(normalized);
  if (isReadCommand && /\bnew\s+lead\b/.test(normalized) && /\b(ticket|tickets|request|requests|lead|leads|record|records|job|jobs|task|tasks)\b/.test(normalized)) {
    return null;
  }

  const ticketId = extractTicketId(text);
  const staffName = extractStaffName(text);
  const region = extractRegionName(text);
  const status = extractStatusValue(text);
  const customerName = extractCreateCustomerName(text);

  if (/\breassign|re-assign\b/.test(normalized)) {
    const params: Record<string, any> = {};
    const fromMatch = text.match(/\bfrom\s+([a-zA-Z ]+?)\s+to\s+([a-zA-Z ]+)\b/i);
    const toMatch = text.match(/\bto\s+([a-zA-Z ]+)\b/i);
    if (ticketId) params.ticketId = ticketId;
    if (fromMatch?.[1] && fromMatch?.[2]) {
      params.fromStaffName = fromMatch[1].trim();
      params.staffName = fromMatch[2].trim();
    } else if (toMatch?.[1]) {
      params.staffName = toMatch[1].trim();
    } else if (staffName) {
      params.staffName = staffName;
    }
    return { intent: "reassignTicket", params, confidence: 0.95 };
  }

  if (/\bassign\b/.test(normalized)) {
    const params: Record<string, any> = {};
    if (ticketId) params.ticketId = ticketId;
    if (staffName) params.staffName = staffName;
    return { intent: "assignTicket", params, confidence: 0.94 };
  }

  if (/\b(delete|remove)\b/.test(normalized) && /\b(ticket|request|job)\b/.test(normalized)) {
    return { intent: "deleteTicket", params: ticketId ? { ticketId } : {}, confidence: 0.95 };
  }

  if (/\bcancel\b/.test(normalized) && /\b(ticket|request|job)\b/.test(normalized)) {
    return { intent: "cancelTicket", params: ticketId ? { ticketId } : {}, confidence: 0.95 };
  }

  if (/\b(update|mark|change)\b/.test(normalized) && /\b(ticket|request|job)\b/.test(normalized)) {
    const params: Record<string, any> = {};
    if (ticketId) params.ticketId = ticketId;
    if (status) params.status = status;
    return { intent: "updateTicketStatus", params, confidence: 0.94 };
  }

  if (/\b(create|add|new)\b/.test(normalized) && /\b(migration|migrate)\b/.test(normalized)) {
    return {
      intent: "createMigrationTicket",
      params: { serviceType: "migration", ...(customerName ? { customerName } : {}), ...(region ? { region } : {}) },
      confidence: 0.93,
    };
  }

  if (/\b(create|add|new)\b/.test(normalized) && /\b(installation|install)\b/.test(normalized)) {
    return {
      intent: "createInstallationTicket",
      params: { serviceType: "installation", ...(customerName ? { customerName } : {}), ...(region ? { region } : {}) },
      confidence: 0.93,
    };
  }

  if (/^new\s+lead\b/.test(normalized) || (/\b(create|add|new)\b/.test(normalized) && /\b(lead|customer|registration)\b/.test(normalized))) {
    return {
      intent: "createLead",
      params: { ...(customerName ? { customerName } : {}), ...(region ? { region } : {}) },
      confidence: 0.93,
    };
  }

  if (/\b(create|add|new)\b/.test(normalized) && /\b(service\s+)?(ticket|request)\b/.test(normalized)) {
    return {
      intent: "createServiceRequest",
      params: { ...(customerName ? { customerName } : {}), ...(region ? { region } : {}) },
      confidence: 0.92,
    };
  }

  return null;
}

function extractNamedValue(text: string): string | null {
  const patterns = [
    /\b(?:does|do|is|are)\s+(?:this\s+|the\s+)?(?:customer|account|company)\s+(?:exist|exists|available|registered|present)(?:\s+(?:in|on)\s+(?:our\s+)?(?:database|crm|system))?\s+(.+)$/i,
    /\b(?:customer|account|company)\s+(.+?)\s+(?:exist|exists|available|registered|present)\b/i,
    /\b(?:named|name|called)\s+(.+)$/i,
    /\b(?:for|of|by)\s+(.+)$/i,
    /\b(?:customer|account|company)\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = match[1].trim().replace(/[.,:;]+$/, "");
      if (value && !/^(history|region|fleet|size|phone|email)$/i.test(value)) return value;
    }
  }
  return null;
}

function extractCustomerNameFromQuery(text: string): string | null {
  const patterns = [
    /\bcustomer\s+history\s+(?:for|of)\s+(.+)$/i,
    /\bhistory\s+(?:for|of)\s+(.+)$/i,
    /\brecent\s+requests\s+(?:by|for|of)\s+(.+)$/i,
    /\brecent\s+activity\s+(?:by|for|of)\s+(.+)$/i,
    /\blast\s+(?:request|service)\s+(?:from|for|of)\s+(.+)$/i,
    /\b(?:open\s+)?(?:tickets|jobs|requests)\s+(?:for|from|of)\s+(.+)$/i,
    /\bopen\s+tickets\s+(?:by|for|of)\s+customer\s+(.+)$/i,
    /\bany\s+issues\s+with\s+(.+)$/i,
    /\bshow\s+contact\s+for\s+(.+)$/i,
    /\b(?:customer\s+details|customer\s+profile|customer\s+profile\s+for|profile)\s+(?:for\s+)?(.+)$/i,
    /\bcustomer\s+activity\s+(?:for|of)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const customerName = match[1].trim().replace(/[.,:;]+$/, "");
      if (customerName) return customerName;
    }
  }

  return null;
}

function extractIssueSearchValue(text: string): string | null {
  const normalized = text.toLowerCase();
  const issueAliases: Array<[RegExp, string]> = [
    [/\b(no\s+connection|offline\s+devices?|offline|not\s+connecting)\b/i, "no connection"],
    [/\bignition\s+issue\b|\bignition\b/i, "ignition"],
    [/\bbattery\s+low\b|\bbattery\s+issues?\b/i, "battery"],
    [/\btracker\s+not\s+working\b|\btracker\s+complaints?\b/i, "tracker not working"],
    [/\bsim\s+replacement\b|\bsim\b/i, "sim"],
    [/\breinstallation\b|\breinstall\b/i, "reinstallation"],
    [/\binstallation\s+history\b|\binstallation\b/i, "installation"],
    [/\brecurring\s+faults?\b|\bfaults?\b/i, "fault"],
  ];
  const matched = issueAliases.find(([pattern]) => pattern.test(text));
  if (matched) return matched[1];

  const vehicleMatch = text.match(/\b(?:vehicle|device)\s+(?:history\s+for\s+|details\s+for\s+|with\s+)?(.+)$/i);
  if (vehicleMatch?.[1] && /\b(vehicle|device)\b/.test(normalized)) {
    return vehicleMatch[1].trim().replace(/\b(details|history)\b$/i, "").replace(/[.,:;]+$/, "").trim();
  }

  return null;
}

function keywordRouter(text: string): boolean {
  const normalized = text.toLowerCase();
  const explicitExampleMatch = intentMappings.some(mapping => {
    return mapping.examples.some(example => normalized.includes(example.split(" ")[0]));
  });
  return explicitExampleMatch || [
    /\b(show|list|view|find|get)\b/,
    /\b(latest|recent|last)\b/,
    /\b(pending|open|active|ongoing|unresolved)\b/,
    /\b(customer|account|company|phone|email|fleet|vehicle|region)\b/,
    /\b(completed|closed|won)\b/,
    /\b(staff|technician|performance|highest|lowest|busiest|least)\b/,
    /\bcustomer\s+history\b/,
    /\btechnician\s+workload\b/,
    /\bworkload\b/,
    /\bduplicate(s)?\b/,
    /\b(migration|migrations|migrate)\b/,
    /\bdashboard\s+summary\b/,
    /\boperations\s+summary\b/,
    /\b(chat|conversation|messages)\b/,
  ].some(pattern => pattern.test(normalized));
}

function detectQueryIntent(text: string): DetectedQueryIntent | null {
  const normalized = normalizeIntentText(text);
  const actionIntent = detectActionIntent(text);
  if (actionIntent) return actionIntent;

  const staffName = extractStaffName(text);
  const region = extractRegionName(text);
  const customerName = extractCustomerNameFromQuery(text);
  const email = extractEmail(text);
  const phone = extractPhone(text);
  const ticketId = extractTicketId(text);
  const issueValue = extractIssueSearchValue(text);
  const dateRange = extractDateRange(text);
  const countOnly = isCountOnlyQuestion(text);
  const hasTicketWord = /\b(ticket|tickets|request|requests|lead|leads|record|records|job|jobs|task|tasks|queue)\b/.test(normalized);
  const hasOpenWord = /\b(pending|open|active|ongoing|unresolved|hold|new)\b/.test(normalized);

  if (/\bpending\b/.test(normalized) && (
    /\bmy\s+pending\b/.test(normalized) ||
    /\bpending\s+(list|items?|work|worklist)\b/.test(normalized) ||
    /\b(list|show|view|get)\s+(my\s+)?pending\b/.test(normalized)
  )) {
    return {
      intent: "getPendingTickets",
      params: { limit: extractQueryLimit(text, 50), countOnly },
      confidence: 0.93,
    };
  }

  if (/\bhow\s+many\b/.test(normalized) && /\bpending\b/.test(normalized) && hasTicketWord) {
    return {
      intent: "getPendingTickets",
      params: { limit: extractQueryLimit(text, 50), countOnly },
      confidence: 0.93,
    };
  }

  if (/\bopen\b/.test(normalized) && /\b(service\s+)?requests?\b/.test(normalized) && /\btoday\b/.test(normalized)) {
    return {
      intent: "getOpenTickets",
      params: { limit: extractQueryLimit(text, 50), countOnly },
      confidence: 0.91,
    };
  }

  if (/\btoday'?s?\s+jobs?\b/.test(normalized) && /\b(all\s+)?technicians?\b/.test(normalized)) {
    return {
      intent: "getOpenTickets",
      params: { limit: extractQueryLimit(text, 50), countOnly },
      confidence: 0.91,
    };
  }

  if (/\b(most\s+common\s+(vehicle\s+)?issues?|common\s+issues?|trend\s+analysis|spot\s+check\s+patterns)\b/.test(normalized)) {
    return {
      intent: "getMostCommonIssues",
      params: { limit: extractQueryLimit(text, 20), dateRange },
      confidence: 0.92,
    };
  }

  if (ticketId && /\b(find|show|view|get|search)\b/.test(normalized)) {
    return {
      intent: "getTicketById",
      params: { ticketId },
      confidence: 0.97,
    };
  }

  if (/\b(unassigned|without\s+assignee|no\s+assignee)\b/.test(normalized) && /\b(ticket|tickets|job|jobs|request|requests|count|queue)\b/.test(normalized)) {
    return {
      intent: "getUnassignedTickets",
      params: { limit: extractQueryLimit(text, 50), dateRange, countOnly },
      confidence: 0.94,
    };
  }

  if (/\b(who\s+is\s+free|free\s+today|available\s+technician|available\s+staff|least\s+workload|lowest\s+workload|overload|overloaded)\b/.test(normalized)) {
    return {
      intent: /\boverload|overloaded\b/.test(normalized) ? "getHighestWorkload" : "getLowestWorkload",
      params: { limit: /\boverload|overloaded\b/.test(normalized) ? 3 : 3 },
      confidence: 0.93,
    };
  }

  if (/\bperformance\s+report\s+for\s+technicians\b/.test(normalized)) {
    return {
      intent: "getStaffPerformance",
      params: { limit: extractQueryLimit(text, 25) },
      confidence: 0.92,
    };
  }

  if (/\b(balance|rebalance|workload\s+analysis|technician\s+overload)\b/.test(normalized)) {
    return {
      intent: "getTechnicianWorkload",
      params: { limit: extractQueryLimit(text, 25) },
      confidence: 0.92,
    };
  }

  if (/\b(migration|migrations|migrate)\b/.test(normalized) && /\b(show|list|view|get|find|recent|latest|history|how\s+many|count|total|ticket|tickets|request|requests|job|jobs|task|tasks|there)\b/.test(normalized)) {
    return {
      intent: "getTicketsByServiceType",
      params: { serviceType: "migration", limit: extractQueryLimit(text, 50), dateRange, countOnly },
      confidence: 0.94,
    };
  }

  if (staffName && /\b(working\s+on|current\s+workload|workload|tasks?|jobs?|assigned|tickets?)\b/.test(normalized)) {
    return {
      intent: "getTicketsByStaff",
      params: { staffName, limit: extractQueryLimit(text, 25), countOnly },
      confidence: 0.94,
    };
  }

  if (staffName && hasTicketWord) {
    return {
      intent: hasOpenWord ? "getPendingTicketsByStaff" : "getTicketsByStaff",
      params: { staffName, limit: extractQueryLimit(text, 25), countOnly },
      confidence: hasOpenWord ? 0.98 : 0.93,
    };
  }

  if (customerName && /\bopen|active|pending|ongoing|unresolved\b/.test(normalized) && /\b(ticket|tickets|job|jobs|request|requests)\b/.test(normalized)) {
    return {
      intent: "getOpenTicketsByCustomer",
      params: { customerName, limit: extractQueryLimit(text, 50), dateRange, countOnly },
      confidence: 0.95,
    };
  }

  if (customerName && /\bshow\s+contact\s+for\b/.test(normalized)) {
    return {
      intent: "findCustomerByName",
      params: { value: customerName, limit: extractQueryLimit(text, 10) },
      confidence: 0.9,
    };
  }

  if (customerName && /\b(customer\s+details|customer\s+profile|profile)\b/.test(normalized)) {
    return {
      intent: "findCustomerByName",
      params: { value: customerName, limit: extractQueryLimit(text, 10) },
      confidence: 0.9,
    };
  }

  if (customerName && /\b(ticket|tickets|job|jobs|request|requests|service|activity|history|issue|issues)\b/.test(normalized)) {
    return {
      intent: /\bhistory|activity|last|recent\b/.test(normalized) ? "getCustomerHistory" : "getTicketsByCustomer",
      params: { customerName, limit: extractQueryLimit(text, 50), dateRange, countOnly },
      confidence: 0.94,
    };
  }

  if (/\b(most\s+common\s+(vehicle\s+)?issues?|common\s+issues?|trend\s+analysis|spot\s+check\s+patterns)\b/.test(normalized)) {
    return {
      intent: "getMostCommonIssues",
      params: { limit: extractQueryLimit(text, 20), dateRange },
      confidence: 0.92,
    };
  }

  if (issueValue && /\b(search|show|which|history|requests?|issues?|complaints?|faults?|devices?|vehicles?|details|summary|common)\b/.test(normalized)) {
    return {
      intent: "getTicketsByIssue",
      params: { value: issueValue, region, limit: extractQueryLimit(text, 50), dateRange, countOnly },
      confidence: 0.93,
    };
  }

  if (/^(show|list|view)$/.test(normalized)) {
    return {
      intent: "getLatestRequests",
      params: { limit: 10 },
      confidence: 0.82,
    };
  }

  if (/\bchat|conversation|messages?\b/.test(normalized)) {
    if (/\bguest|public\b/.test(normalized)) {
      return {
        intent: "getGuestChatHistory",
        params: { limit: extractQueryLimit(text, 25) },
        confidence: 0.92,
      };
    }
    if (/\bstaff|technician\b/.test(normalized) || staffName) {
      return {
        intent: "getStaffChatHistory",
        params: { channelName: staffName ? `staff:${staffName}` : undefined, limit: extractQueryLimit(text, 25) },
        confidence: 0.92,
      };
    }
  }

  if (email && /\b(customer|account|company|email)\b/.test(normalized)) {
    return {
      intent: "findCustomerByEmail",
      params: { value: email, limit: extractQueryLimit(text, 10) },
      confidence: 0.97,
    };
  }

  if (phone && /\b(customer|account|company|phone|mobile|number)\b/.test(normalized)) {
    return {
      intent: "findCustomerByPhone",
      params: { value: phone, limit: extractQueryLimit(text, 10) },
      confidence: 0.97,
    };
  }

  if (/\b(fleet\s+size|vehicle\s+count|vehicles|units)\b/.test(normalized)) {
    const value = customerName || extractNamedValue(text);
    if (value) {
      return {
        intent: "getCustomerFleetSize",
        params: { customerName: value, limit: extractQueryLimit(text, 10) },
        confidence: 0.94,
      };
    }
  }

  if (/\b(customer|account|company)\b/.test(normalized) && /\b(region|emirate|location|located|where)\b/.test(normalized)) {
    const value = customerName || extractNamedValue(text);
    if (value) {
      return {
        intent: "getCustomerRegion",
        params: { customerName: value, limit: extractQueryLimit(text, 10) },
        confidence: 0.94,
      };
    }
  }

  if (customerName) {
    return {
      intent: "getCustomerHistory",
      params: { customerName, limit: extractQueryLimit(text, 25) },
      confidence: 0.96,
    };
  }

  if (/\b(customer|account|company)\b/.test(normalized) && /\b(find|search|show|get|view|exist|exists|available|registered|present)\b/.test(normalized)) {
    const value = extractNamedValue(text);
    if (value) {
      return {
        intent: "findCustomerByName",
        params: { value, limit: extractQueryLimit(text, 10) },
        confidence: 0.9,
      };
    }
  }

  if (/\b(search|find|show\s+contact\s+for)\b/.test(normalized)) {
    const value = extractNamedValue(text) || text.replace(/^\s*(search\s+for|search|find|show\s+contact\s+for)\s+/i, "").trim().replace(/[?!.,:;]+$/, "");
    if (value.length >= 2 && value.length <= 160) {
      return {
        intent: "findCustomerByName",
        params: { value, limit: extractQueryLimit(text, 10) },
        confidence: 0.89,
      };
    }
  }

  if (staffName && hasTicketWord && hasOpenWord) {
    return {
      intent: "getPendingTicketsByStaff",
      params: { staffName, limit: extractQueryLimit(text, 25), countOnly },
      confidence: 0.98,
    };
  }

  if (region && hasTicketWord && hasOpenWord) {
    return {
      intent: "getOpenTicketsByRegion",
      params: { region, limit: extractQueryLimit(text, 10), dateRange, countOnly, latest: /\b(latest|recent|last)\b/.test(normalized) },
      confidence: 0.97,
    };
  }

  if (region && hasTicketWord) {
    return {
      intent: "getTicketsByRegion",
      params: { region, limit: extractQueryLimit(text, 10), dateRange, countOnly, latest: /\b(latest|recent|last)\b/.test(normalized) },
      confidence: 0.92,
    };
  }

  if (/\b(highest|busiest|most\s+loaded|most\s+tickets|maximum\s+workload)\b/.test(normalized)) {
    return {
      intent: "getHighestWorkload",
      params: { limit: 1 },
      confidence: 0.93,
    };
  }

  if (/\b(lowest|least\s+busy|least\s+loaded|least\s+tickets|minimum\s+workload|available\s+staff)\b/.test(normalized)) {
    return {
      intent: "getLowestWorkload",
      params: { limit: 1 },
      confidence: 0.93,
    };
  }

  if (/\b(staff|technician|team)\b/.test(normalized) && /\b(performance|completed|productivity)\b/.test(normalized)) {
    return {
      intent: "getStaffPerformance",
      params: { limit: extractQueryLimit(text, 25) },
      confidence: 0.92,
    };
  }

  if (/\b(technician\s+workload|workload\s+by\s+technician|workload)\b/.test(normalized)) {
    return {
      intent: "getTechnicianWorkload",
      params: { limit: extractQueryLimit(text, 25) },
      confidence: 0.92,
    };
  }

  if (/\b(duplicate|duplicates|duplicate\s+requests|duplicate\s+tickets)\b/.test(normalized)) {
    return {
      intent: "getDuplicateRequests",
      params: { limit: extractQueryLimit(text, 25) },
      confidence: 0.92,
    };
  }

  if (/\b(need|needs|requiring|require|requires)\s+attention\b/.test(normalized) || /\battention\s+(ticket|tickets|request|requests|queue)\b/.test(normalized)) {
    return {
      intent: "getTicketsNeedingAttention",
      params: { limit: extractQueryLimit(text, 50), countOnly },
      confidence: 0.93,
    };
  }

  if (/\bcustomer\s+with\s+most\s+requests\b|\bhigh\s+priority\s+customers\b/.test(normalized)) {
    return {
      intent: "getCustomerWithMostRequests",
      params: { limit: extractQueryLimit(text, 20), dateRange },
      confidence: 0.92,
    };
  }

  if (/\b(region|regional|emirate)\b/.test(normalized) && /\b(summary|breakdown|count|workload)\b/.test(normalized)) {
    return {
      intent: "getRegionSummary",
      params: { region, limit: extractQueryLimit(text, 25), dateRange },
      confidence: 0.91,
    };
  }

  if (/\b(status)\b/.test(normalized) && /\b(summary|breakdown|count)\b/.test(normalized)) {
    return {
      intent: "getStatusSummary",
      params: { limit: extractQueryLimit(text, 25), dateRange },
      confidence: 0.91,
    };
  }

  if (/\b(daily|today|day)\b/.test(normalized) && /\b(summary|snapshot|operations|report)\b/.test(normalized)) {
    return {
      intent: "getDailySummary",
      params: { limit: extractQueryLimit(text, 7) },
      confidence: 0.91,
    };
  }

  if (/\b(monthly|month)\b/.test(normalized) && /\b(summary|snapshot|operations|report)\b/.test(normalized)) {
    return {
      intent: "getMonthlySummary",
      params: { limit: extractQueryLimit(text, 12) },
      confidence: 0.91,
    };
  }

  if (/\b(completed|closed|won|solved)\b/.test(normalized) && /\btoday\b/.test(normalized) && hasTicketWord) {
    return {
      intent: "getCompletedTickets",
      params: { limit: extractQueryLimit(text, 50), dateRange: "today", countOnly },
      confidence: 0.92,
    };
  }

  if (/\bfull\s+service\s+queue\b/.test(normalized)) {
    return {
      intent: "getOpenTickets",
      params: { limit: extractQueryLimit(text, 50) },
      confidence: 0.91,
    };
  }

  if (/\b(alerts?|sla|risks?|recommended\s+actions)\b/.test(normalized)) {
    return {
      intent: "getTicketsNeedingAttention",
      params: { limit: extractQueryLimit(text, 50), countOnly },
      confidence: 0.91,
    };
  }

  if (/\bweekly\s+summary\b/.test(normalized)) {
    return {
      intent: "getDailySummary",
      params: { limit: 7 },
      confidence: 0.91,
    };
  }

  if (
    /\b(dashboard\s+summary|operations\s+summary|summary|snapshot)\b/.test(normalized) ||
    /\b(full\s+overview|overall\s+fleet\s+status|operational\s+dashboard|service\s+statistics|queue\s+snapshot|recommended\s+actions)\b/.test(normalized) ||
    /\b(trend\s+analysis|spot\s+check\s+patterns|high\s+priority\s+customers)\b/.test(normalized) ||
    (/\b(total|count|how\s+many|overall)\b/.test(normalized) && /\b(record|records|ticket|tickets|request|requests|lead|leads|customer|customers|database|crm|system)\b/.test(normalized))
  ) {
    return {
      intent: "getDashboardSummary",
      params: { dateRange },
      confidence: 0.9,
    };
  }

  if (/\b(completed|closed|won|solved)\b/.test(normalized) && /\b(this\s+week|week)\b/.test(normalized) && hasTicketWord) {
    return {
      intent: "getCompletedTicketsThisWeek",
      params: { limit: extractQueryLimit(text, 50), dateRange: "this_week", countOnly },
      confidence: 0.94,
    };
  }

  if (/\bnew\s+lead\b/.test(normalized) && hasTicketWord && /\b(show|list|view|get|find)\b/.test(normalized)) {
    return {
      intent: "getTicketsByStatusLabel",
      params: { statusLabel: "new lead", limit: extractQueryLimit(text, 50) },
      confidence: 0.94,
    };
  }

  if (/\b(completed|closed|won|solved)\b/.test(normalized) && hasTicketWord) {
    return {
      intent: "getCompletedTickets",
      params: { limit: extractQueryLimit(text, 10), dateRange, countOnly },
      confidence: 0.93,
    };
  }

  if (/\b(pending)\b/.test(normalized) && (hasTicketWord || /\b(can\s+i\s+know|what|how\s+many|status|queue)\b/.test(normalized))) {
    return {
      intent: "getPendingTickets",
      params: { limit: extractQueryLimit(text, 50), dateRange, countOnly },
      confidence: 0.93,
    };
  }

  if (hasOpenWord && (hasTicketWord || /\b(can\s+i\s+know|what|how\s+many|status|queue)\b/.test(normalized))) {
    return {
      intent: "getOpenTickets",
      params: { limit: extractQueryLimit(text, 50), dateRange, countOnly },
      confidence: 0.91,
    };
  }

  if (/\b(latest|last|recent)\s+(\d{1,3}\s+)?(record|records|request|requests|ticket|tickets|lead|leads)\b/.test(normalized)) {
    return {
      intent: "getLatestRequests",
      params: { limit: extractQueryLimit(text, 10) },
      confidence: 0.94,
    };
  }

  if (/\b(show|list|view)\s+(my\s+)?(record|records|request|requests|ticket|tickets|lead|leads)\b/.test(normalized)) {
    return {
      intent: "getLatestRequests",
      params: { limit: extractQueryLimit(text, 10) },
      confidence: 0.86,
    };
  }

  return null;
}

function validateQueryIntent(detected: DetectedQueryIntent | null): DetectedQueryIntent {
  if (!detected || !safeQueryHandlers[detected.intent]) {
    throw Object.assign(new Error("Unsupported query intent."), { statusCode: 400 });
  }
  return detected;
}

function normalizeDetectedIntentName(intent: unknown): SafeQueryIntent | "unknown" {
  const mapped: Record<string, SafeQueryIntent> = {
    getRecordsByStaff: "getTicketsByStaff",
    getRecordsByRegion: "getTicketsByRegion",
    getMyPendingTickets: "getPendingTickets",
    getLatestRecords: "getLatestRequests",
  };
  const raw = String(intent || "");
  const normalized = mapped[raw] || raw;
  return safeQueryHandlers[normalized as SafeQueryIntent] ? normalized as SafeQueryIntent : "unknown";
}

function containsUnsafeSqlText(value: unknown): boolean {
  const raw = typeof value === "string" ? value : JSON.stringify(value || "");
  return /\b(select\s+.+\s+from|update\s+\w+\s+set|delete\s+from|insert\s+into|drop\s+table|alter\s+table|create\s+table|truncate\s+table|execute\s+\w+|join\s+\w+\s+on)\b/i.test(raw);
}

function parseProviderIntent(raw: string): DetectedQueryIntent {
  if (containsUnsafeSqlText(raw)) {
    throw new Error("Provider response contained forbidden database language.");
  }

  const cleaned = raw.replace(/```json|```/gi, "").trim();
  const parsed = JSON.parse(cleaned);
  if (containsUnsafeSqlText(parsed)) {
    throw new Error("Provider response contained forbidden database language.");
  }

  const intent = normalizeDetectedIntentName(parsed.intent);
  if (intent === "unknown") {
    throw new Error("Provider returned an unsupported intent.");
  }

  return {
    intent,
    params: parsed.params && typeof parsed.params === "object" ? parsed.params : {},
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(parsed.confidence, 1)) : 0.5,
  };
}

function normalizeQueryAiMode(value: unknown, authUser: AuthUser): SafeQueryAiMode {
  const raw = String(value || process.env.SAFE_QUERY_AI_MODE || "local").toLowerCase();
  if (raw === "extra" || raw === "gemma" || raw === "cohere") return "openrouter";
  return raw === "gemini" || raw === "compare" || raw === "local" || raw === "nvidia" || raw === "openrouter" ? raw : "local";
}

function normalizeProviderName(value: unknown): QueryProviderName | null {
  const raw = String(value || "").toLowerCase().trim();
  if (raw === "gemini" || raw === "local" || raw === "nvidia") return raw;
  if (raw === "openrouter" || raw === "extra" || raw === "gemma" || raw === "cohere") return "openrouter";
  return null;
}

function normalizeCompareProviders(value: unknown): QueryProviderName[] {
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

function getProviderLabel(provider: QueryProviderName): string {
  if (provider === "gemini") return "Gemini";
  if (provider === "local") return "Local LLM";
  if (provider === "nvidia") return openRouterPrimaryLabel;
  return "Cohere";
}

function isOpenRouterPolicyEndpointError(error: string): boolean {
  return /No endpoints available matching your guardrail restrictions and data policy|settings\/privacy|status 404/i.test(String(error || ""));
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
  if (provider === "nvidia" && /status 429|Provider returned error|rate.?limit|thrott/i.test(raw)) {
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
  if (!cleanedOpenRouterKey) {
    throw new Error("OpenRouter provider is not configured on this server.");
  }

  const requestMessages = args.reasoning && args.reasoningStateKey
    ? [
        ...args.messages.filter(message => message.role === "system"),
        ...(openRouterReasoningMessages.get(args.reasoningStateKey) || []),
        ...args.messages.filter(message => message.role !== "system").slice(-1),
      ]
    : args.messages;

  const response = await axios.post(`${openRouterBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    model: args.model || openRouterModel,
    messages: requestMessages,
    temperature: args.temperature ?? 0.2,
    max_tokens: args.maxTokens ?? 1200,
    stream: false,
    ...(args.reasoning ? { reasoning: { enabled: true } } : {}),
    ...(args.json ? { response_format: { type: "json_object" } } : {}),
  }, {
    timeout: 300000,
    headers: {
      Authorization: `Bearer ${cleanedOpenRouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
      "X-Title": process.env.OPENROUTER_APP_NAME || "SynoHub",
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
        const detected = parseProviderIntent(stdout.trim());
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

    const detected = parseProviderIntent(raw || "");
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

    const detected = parseProviderIntent(raw || "");
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

    const detected = parseProviderIntent(raw || "");
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

function providerToDetected(result: QueryProviderResult): DetectedQueryIntent | null {
  if (result.error || !result.intent) return null;
  return {
    intent: result.intent,
    params: result.params || {},
    confidence: typeof result.confidence === "number" ? result.confidence : 0.5,
  };
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
  const validated = validateQueryIntent(detected);
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

function validateQueryParams(detected: DetectedQueryIntent, authUser: AuthUser): Record<string, any> {
  const params = { ...detected.params };
  const normalizedAuthName = normalizeUserName(authUser.name);

  if (actionIntents.has(detected.intent)) {
    const createActionIntents = new Set<SafeQueryIntent>([
      "createLead",
      "createServiceRequest",
      "createMigrationTicket",
      "createInstallationTicket",
    ]);
    const staffDeniedActionIntents = new Set<SafeQueryIntent>([
      "assignTicket",
      "reassignTicket",
      "updateTicketStatus",
      "deleteTicket",
      "cancelTicket",
    ]);
    const guestDeniedActionIntents = new Set<SafeQueryIntent>([
      "assignTicket",
      "reassignTicket",
      "updateTicketStatus",
      "deleteTicket",
      "cancelTicket",
    ]);

    if (authUser.role === "staff" && staffDeniedActionIntents.has(detected.intent)) {
      throw Object.assign(new Error("Access restricted. Staff users can classify this action, but cannot execute or authorize ticket assignment, reassignment, status update, cancellation, or deletion from this endpoint."), { statusCode: 403 });
    }

    if (authUser.role === "guest" && guestDeniedActionIntents.has(detected.intent)) {
      throw Object.assign(new Error("Access restricted. Guest users cannot assign, reassign, update, cancel, or delete tickets."), { statusCode: 403 });
    }

    if (authUser.role === "guest" && !createActionIntents.has(detected.intent)) {
      throw Object.assign(new Error("Access restricted. Guest users can only classify limited create-record actions."), { statusCode: 403 });
    }

    if (params.ticketId !== undefined) {
      const ticketId = Number(params.ticketId);
      if (Number.isInteger(ticketId) && ticketId > 0) {
        params.ticketId = ticketId;
      } else {
        delete params.ticketId;
      }
    }
    if (typeof params.staffName === "string") {
      const canonicalStaff = staffRoster.find(name => name.toLowerCase() === params.staffName.trim().toLowerCase());
      params.staffName = canonicalStaff || params.staffName.trim();
    }
    if (typeof params.fromStaffName === "string") {
      const canonicalStaff = staffRoster.find(name => name.toLowerCase() === params.fromStaffName.trim().toLowerCase());
      params.fromStaffName = canonicalStaff || params.fromStaffName.trim();
    }
    if (typeof params.status === "string") {
      params.status = params.status.trim();
    }
    if (typeof params.customerName === "string") {
      params.customerName = params.customerName.trim().replace(/[?!.,:;]+$/, "");
    }
    if (typeof params.region === "string") {
      const canonicalRegion = Object.values(regionAliases).find(value => value.toLowerCase() === params.region.trim().toLowerCase());
      if (canonicalRegion) params.region = canonicalRegion;
    }
    return params;
  }

  if (params.limit !== undefined) {
    params.limit = extractQueryLimit(String(params.limit), 10);
  }

  if (params.dateRange !== undefined && !["today", "this_week", "this_month"].includes(String(params.dateRange))) {
    delete params.dateRange;
  }

  if (params.countOnly !== undefined) {
    params.countOnly = params.countOnly === true || String(params.countOnly).toLowerCase() === "true";
  }

  if (["getPendingTicketsByStaff", "getTicketsByStaff"].includes(detected.intent)) {
    const staffName = typeof params.staffName === "string" ? params.staffName.trim() : "";
    const canonicalStaff = staffRoster.find(name => name.toLowerCase() === staffName.toLowerCase());
    if (!canonicalStaff) {
      throw Object.assign(new Error("Invalid staff name for query."), { statusCode: 400 });
    }
    if (authUser.role === "staff" && canonicalStaff.toLowerCase() !== normalizedAuthName) {
      throw Object.assign(new Error("Access restricted. Staff users can only query their own records."), { statusCode: 403 });
    }
    if (authUser.role === "guest") {
      throw Object.assign(new Error("Access restricted. Guest users cannot query staff tickets."), { statusCode: 403 });
    }
    params.staffName = canonicalStaff;
  }

  if (["getOpenTicketsByRegion", "getTicketsByRegion", "getRegionSummary"].includes(detected.intent)) {
    const region = typeof params.region === "string" ? params.region.trim() : "";
    const canonicalRegion = region
      ? Object.values(regionAliases).find(value => value.toLowerCase() === region.toLowerCase())
      : undefined;
    if (["getOpenTicketsByRegion", "getTicketsByRegion"].includes(detected.intent) && !canonicalRegion) {
      throw Object.assign(new Error("Invalid region for query."), { statusCode: 400 });
    }
    if (canonicalRegion) {
      params.region = canonicalRegion;
    } else {
      delete params.region;
    }
  }

  if (detected.intent === "getTicketsByIssue" && params.region !== undefined) {
    const region = typeof params.region === "string" ? params.region.trim() : "";
    const canonicalRegion = Object.values(regionAliases).find(value => value.toLowerCase() === region.toLowerCase());
    if (canonicalRegion) {
      params.region = canonicalRegion;
    } else {
      delete params.region;
    }
  }

  if (detected.intent === "getTicketsByServiceType") {
    const requestedType = typeof params.serviceType === "string" ? params.serviceType.trim().toLowerCase() : "";
    const serviceTypeAliases: Record<string, string> = {
      migration: "migration",
      migrations: "migration",
      migrate: "migration",
      locator: "locator",
      locators: "locator",
      service: "service",
      installation: "installation",
      install: "installation",
      reinstallation: "reinstallation",
      reinstall: "reinstallation",
      removal: "removal",
      "device removal": "removal",
    };
    const canonicalServiceType = serviceTypeAliases[requestedType];
    if (!canonicalServiceType) {
      throw Object.assign(new Error("Invalid service type for query."), { statusCode: 400 });
    }
    params.serviceType = canonicalServiceType;
  }

  if (detected.intent === "getTicketById") {
    const ticketId = Number(params.ticketId);
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      throw Object.assign(new Error("Invalid ticket ID for query."), { statusCode: 400 });
    }
    params.ticketId = ticketId;
  }

  if (detected.intent === "getTicketsByStatusLabel") {
    const requestedStatus = typeof params.statusLabel === "string" ? params.statusLabel.trim().toLowerCase() : "";
    const statusAliases: Record<string, string> = {
      "new lead": "new lead",
      new: "new",
      hold: "hold",
      proposed: "proposed",
      won: "won",
      completed: "completed",
      closed: "completed",
      solved: "completed",
      pending: "pending",
    };
    const canonicalStatus = statusAliases[requestedStatus];
    if (!canonicalStatus) {
      throw Object.assign(new Error("Invalid status for query."), { statusCode: 400 });
    }
    params.statusLabel = canonicalStatus;
  }

  if (["getCustomerHistory", "getCustomerFleetSize", "getCustomerRegion", "getTicketsByCustomer", "getOpenTicketsByCustomer"].includes(detected.intent)) {
    const customerName = typeof params.customerName === "string" ? params.customerName.trim().replace(/[?!.,:;]+$/, "") : "";
    if (customerName.length < queryValidationRules.minCustomerSearchLength || customerName.length > queryValidationRules.maxCustomerSearchLength) {
      throw Object.assign(new Error("Invalid customer name for query."), { statusCode: 400 });
    }
    params.customerName = customerName;
  }

  if (detected.intent === "getTicketsByIssue") {
    const value = typeof params.value === "string" ? params.value.trim() : "";
    if (value.length < 2 || value.length > 160) {
      throw Object.assign(new Error("Invalid issue search value."), { statusCode: 400 });
    }
    params.value = value;
  }

  if (["findCustomerByName", "findCustomerByPhone", "findCustomerByEmail"].includes(detected.intent)) {
    const value = typeof params.value === "string" ? params.value.trim() : "";
    if (value.length < 2 || value.length > 160) {
      throw Object.assign(new Error("Invalid customer search value."), { statusCode: 400 });
    }
    params.value = value;
  }

  if (detected.intent === "getStaffChatHistory") {
    if (authUser.role === "guest") {
      throw Object.assign(new Error("Access restricted. Guest users cannot query staff chat history."), { statusCode: 403 });
    }
    if (params.channelName && authUser.role === "staff") {
      const requestedStaff = String(params.channelName).replace(/^staff:/i, "").trim();
      if (requestedStaff.toLowerCase() !== normalizedAuthName) {
        throw Object.assign(new Error("Access restricted. Staff users can only query their own chat history."), { statusCode: 403 });
      }
    }
  }

  if (detected.intent === "getGuestChatHistory" && authUser.role === "staff") {
    throw Object.assign(new Error("Access restricted. Staff users cannot query guest chat history."), { statusCode: 403 });
  }

  if (authUser.role === "guest" && queryValidationRules.forbiddenForGuest.includes(detected.intent)) {
    throw Object.assign(new Error("Access restricted. Guest users can only query records created by their account."), { statusCode: 403 });
  }

  return params;
}

function summarizeRow(row: any): string {
  const status = row.jobStatus || row.status || "Pending";
  const description = cleanRecordDescription(row.issueDescription || row.comment || row.implementationType || "No description");
  const location = row.location || row.region || "";
  return `#${row.id} | ${row.customerName || "Unknown customer"} | ${status}${location ? ` | ${location}` : ""} | ${description}`;
}

function getRowAssignee(row: any): string {
  return row.salesPerson || row.requestedPerson || "Unassigned";
}

function getRowStatus(row: any): string {
  return String(row.jobStatus || row.status || "Pending").trim() || "Pending";
}

function getLeadStatus(row: any): string {
  return String(row.status || row.jobStatus || "Pending").trim() || "Pending";
}

function getRowDescription(row: any): string {
  return cleanRecordDescription(row.issueDescription || row.comment || row.implementationType || "No description");
}

function formatQueueItem(row: any, duplicateAlert = false, statusMode: "job" | "lead" = "job"): string {
  const description = getRowDescription(row);
  const assignee = getRowAssignee(row);
  const location = row.location || row.region || "";
  const suffix = [
    `${statusMode === "lead" ? getLeadStatus(row) : getRowStatus(row)} | Assignee: ${assignee}`,
    location ? `Location: ${location}` : "",
  ].filter(Boolean).join(" | ");
  return `- ID ${row.id}: ${row.customerName || "Unknown customer"} - ${description} (${suffix})${duplicateAlert ? " [Duplicate Alert]" : ""}${assignee === "Unassigned" ? " [Needs Assignee]" : ""}`;
}

function humanDateRangeLabel(dateRange?: string): string {
  if (dateRange === "today") return " for today";
  if (dateRange === "this_week") return " from the last 7 days";
  if (dateRange === "this_month") return " for this month";
  return "";
}

function formatOperationalAnswer(parts: {
  title?: string;
  direct: string | string[];
  breakdown?: string[];
  details?: string[];
  suggestedActions?: string[];
}): string {
  const lines: string[] = [];
  if (parts.title) {
    lines.push(parts.title, "");
  }

  lines.push("Direct Answer:");
  lines.push(...(Array.isArray(parts.direct) ? parts.direct : [parts.direct]));

  if (parts.breakdown?.length) {
    lines.push("", "Breakdown:", ...parts.breakdown);
  }

  if (parts.details?.length) {
    lines.push("", "Details:", ...parts.details);
  }

  if (parts.suggestedActions?.length) {
    lines.push("", "Suggested Actions:", ...parts.suggestedActions);
  }

  return lines.join("\n").trim();
}

function formatQueueReport(rows: any[], title = "active service queue", options: { countOnly?: boolean; dateRange?: string } = {}): string {
  const titleWithRange = `${title}${humanDateRangeLabel(options.dateRange)}`;
  if (rows.length === 0) {
    return formatOperationalAnswer({
      direct: `I do not see any visible records in the ${titleWithRange}.`,
      suggestedActions: [
        "- Check a broader date range or ask for the latest service queue.",
        "- Create a new service ticket if this is a fresh customer request.",
      ],
    });
  }

  const totalMatches = Number(rows[0]?.totalMatches || rows.length);
  if (options.countOnly) {
    return formatOperationalAnswer({
      direct: `There are ${totalMatches} visible ticket${totalMatches === 1 ? "" : "s"} in the ${titleWithRange}.`,
    });
  }
  const duplicateKeys = rows.reduce((counts: Record<string, number>, row: any) => {
    const key = `${String(row.customerName || "").toLowerCase()}|${getRowDescription(row).toLowerCase()}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

  const withDuplicateFlag = rows.map(row => {
    const key = `${String(row.customerName || "").toLowerCase()}|${getRowDescription(row).toLowerCase()}`;
    return { row, duplicateAlert: duplicateKeys[key] > 1 };
  });

  const isAttention = ({ row, duplicateAlert }: { row: any; duplicateAlert: boolean }) => {
    const description = getRowDescription(row).toLowerCase();
    return duplicateAlert
      || getRowAssignee(row) === "Unassigned"
      || /\b(no connection|not connecting|offline|ignition|tracker not working|battery low|missing)\b/.test(description);
  };
  const isNew = ({ row }: { row: any }) => getRowStatus(row).toLowerCase() === "new";

  const attention = withDuplicateFlag.filter(isAttention).slice(0, 12);
  const newRequests = withDuplicateFlag.filter(item => isNew(item) && !isAttention(item)).slice(0, 8);
  const active = withDuplicateFlag.filter(item => !isAttention(item) && !isNew(item)).slice(0, 24);
  const pendingCount = rows.filter(row => getRowStatus(row).toLowerCase() === "pending").length;
  const newCount = rows.filter(row => getRowStatus(row).toLowerCase() === "new").length;
  const unassignedCount = rows.filter(row => getRowAssignee(row) === "Unassigned").length;
  const duplicateCount = withDuplicateFlag.filter(item => item.duplicateAlert).length;

  const busiest = rows.reduce((counts: Record<string, number>, row: any) => {
    const assignee = getRowAssignee(row);
    if (assignee !== "Unassigned") counts[assignee] = (counts[assignee] || 0) + 1;
    return counts;
  }, {});
  const busiestStaff = (Object.entries(busiest) as Array<[string, number]>).sort((a, b) => b[1] - a[1])[0];

  const breakdown = [
    `- Requires Attention: ${attention.length} ticket${attention.length === 1 ? "" : "s"}`,
    `- Active Requests: ${active.length} ticket${active.length === 1 ? "" : "s"}`,
    `- New Requests: ${newCount} ticket${newCount === 1 ? "" : "s"}`,
    `- Duplicate Alerts: ${duplicateCount} ticket${duplicateCount === 1 ? "" : "s"}`,
  ];

  const details: string[] = [];
  if (attention.length > 0) {
    details.push("Requires Attention / Duplicate Alerts:", ...attention.map(item => formatQueueItem(item.row, item.duplicateAlert)));
  }

  if (newRequests.length > 0) {
    details.push("New Requests:", ...newRequests.map(item => formatQueueItem(item.row, item.duplicateAlert)));
  }

  if (active.length > 0) {
    details.push("Active Requests:", ...active.map(item => formatQueueItem(item.row, item.duplicateAlert)));
  }

  return formatOperationalAnswer({
    title: `SynoHub ${titleWithRange} overview`,
    direct: `There are ${totalMatches} visible ticket${totalMatches === 1 ? "" : "s"} in this result set. Showing latest ${rows.length}.`,
    breakdown,
    details,
    suggestedActions: [
      duplicateCount > 0 ? "- Review duplicate alerts and consolidate engineer schedules where appropriate." : "- Review high-priority connection and ignition issues first.",
      unassignedCount > 0 ? "- Assign technicians to unassigned tickets before dispatch planning." : "- Check technician workload before assigning the next service visit.",
      busiestStaff ? `- Rebalance workload if needed; ${busiestStaff[0]} currently appears most often in this result set.` : "- Use technician workload if you want a staff-wise assignment summary.",
    ],
  });
}

function isSimpleGreetingMessage(text: string): boolean {
  return /^(hi|hello|hey|hai|hii|good\s+morning|good\s+afternoon|good\s+evening)\s*[!.?]*$/i.test(String(text || "").trim());
}

function formatOperationalGreeting(userName: string, rows: any[]): string {
  const displayName = userName || "there";
  const closedStatuses = new Set(["completed", "won", "lost", "duplicate", "deleted", "cancelled", "canceled"]);
  const activeRows = rows.filter(row => {
    const status = String(row.jobStatus || row.status || "").trim().toLowerCase();
    return !closedStatuses.has(status);
  });

  const groups = activeRows.reduce((acc: Record<string, any[]>, row: any) => {
    const key = [
      String(row.customerName || "").trim().toLowerCase(),
      getRowDescription(row).trim().toLowerCase(),
      String(row.location || row.region || "").trim().toLowerCase(),
    ].join("|");
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  const duplicateGroup = (Object.values(groups) as any[][])
    .filter(group => group.length > 1)
    .sort((a, b) => Number(b[0]?.id || 0) - Number(a[0]?.id || 0))[0];

  const lines = [
    `Hello ${displayName}! Welcome to SynoHub. How can I help you with SynoHub fleet intelligence operations today?`,
  ];

  if (duplicateGroup?.length) {
    const sortedGroup = [...duplicateGroup].sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    const first = sortedGroup[0];
    const ids = sortedGroup.map(row => `ID ${row.id}`).join(" and ");
    const customer = first.customerName || "this customer";
    const issue = getRowDescription(first).toLowerCase();
    const location = first.location || first.region || "";
    const assignee = getRowAssignee(first);
    const assigneeText = assignee && assignee !== "Unassigned" ? ` Both are currently assigned to ${assignee}.` : "";
    lines.push(
      "",
      `I noticed duplicate pending tickets for ${customer} (${ids}) for the ${issue} service${location ? ` in ${location}` : ""}.${assigneeText}`
    );
  } else if (activeRows.length > 0) {
    const latest = activeRows[0];
    lines.push(
      "",
      `You currently have ${activeRows.length} visible active request${activeRows.length === 1 ? "" : "s"}. Latest: ID ${latest.id}, ${latest.customerName || "Unknown customer"} - ${getRowDescription(latest)}.`
    );
  }

  lines.push(
    "",
    "Would you like me to help you manage these requests, check your active workload, or register a new client?"
  );

  return lines.join("\n");
}

function formatStaffWorkloadReport(staffName: string, rows: any[], pendingOnly = false, options: { countOnly?: boolean; dateRange?: string } = {}): string {
  if (rows.length === 0) {
    return formatOperationalAnswer({
      title: `${staffName.toUpperCase()} WORKLOAD SUMMARY`,
      direct: `${staffName} has no visible ${pendingOnly ? "pending " : ""}records for your access level.`,
      suggestedActions: [
        "- Check spelling of the staff name.",
        "- Review the full technician workload if you want another assignment option.",
      ],
    });
  }

  const activeStatuses = new Set(["pending", "new", "new lead", "hold", "ongoing"]);
  const activeRows = rows.filter(row => activeStatuses.has(getRowStatus(row).toLowerCase()));
  const totalMatches = Number(rows[0]?.totalMatches || rows.length);
  const openMatches = Number(rows[0]?.openMatches || activeRows.length);
  if (options.countOnly) {
    return `Direct Answer:\n${staffName} has ${openMatches} visible active job${openMatches === 1 ? "" : "s"}${humanDateRangeLabel(options.dateRange)}.`;
  }
  const newRows = rows.filter(row => getRowStatus(row).toLowerCase() === "new");
  const pendingRows = rows.filter(row => getRowStatus(row).toLowerCase() === "pending");
  const completedRows = rows.filter(row => ["completed", "won", "solved"].includes(getRowStatus(row).toLowerCase()));

  const formatCompact = (row: any) => {
    const location = row.location || row.region || "";
    return `- ${row.id} | ${row.customerName || "Unknown customer"} | ${getRowDescription(row)} | ${getRowStatus(row)}${location ? ` | ${location}` : ""}`;
  };
  const byDescription = (pattern: RegExp) => rows.filter(row => pattern.test(getRowDescription(row)));

  const sections = [
    `${staffName.toUpperCase()} WORKLOAD SUMMARY`,
    "",
    "Direct Answer:",
    `${staffName} has ${openMatches} active ticket${openMatches === 1 ? "" : "s"} out of ${totalMatches} visible record${totalMatches === 1 ? "" : "s"}${humanDateRangeLabel(options.dateRange)}.`,
    "",
    "Breakdown:",
    `Total Visible Records: ${totalMatches}`,
    `Total Active Tickets: ${openMatches}`,
    `Showing Latest: ${rows.length}`,
    "",
  ];

  if (newRows.length > 0) {
    sections.push("New Tickets:", newRows.slice(0, 8).map(formatCompact).join("\n"), "");
  }

  if (pendingRows.length > 0) {
    sections.push("Pending Tickets:", pendingRows.slice(0, 20).map(formatCompact).join("\n"), "");
  }

  const categories = [
    ["Migration Jobs", byDescription(/\bmigration|migrate\b/i)],
    ["Tracker Not Working / No Connection", byDescription(/\btracker not working|no connection|not connecting|offline|ignition\b/i)],
    ["Reinstallation Jobs", byDescription(/\bre-?installation|reinstall\b/i)],
    ["Device Removal Jobs", byDescription(/\bdevice removal|remove\b/i)],
  ] as Array<[string, any[]]>;

  for (const [label, matches] of categories) {
    sections.push(label + ":");
    sections.push(matches.length > 0 ? matches.slice(0, 10).map(formatCompact).join("\n") : "None");
    sections.push("");
  }

  if (completedRows.length > 0) {
    sections.push("Recent Completed:", completedRows.slice(0, 5).map(formatCompact).join("\n"), "");
  }

  sections.push(
    "Suggested Actions:",
    `- Review ${staffName}'s pending jobs before assigning new work.`,
    "- Check duplicate customer/service issues before dispatch.",
    "- Confirm location and vehicle plate details for field visits."
  );

  return sections.join("\n").trim();
}

function formatServiceTypeReport(serviceType: string, rows: any[], options: { countOnly?: boolean; dateRange?: string } = {}): string {
  const label = serviceType === "migration" ? "migration" : serviceType;
  const titleLabel = label.charAt(0).toUpperCase() + label.slice(1);
  const rangeLabel = humanDateRangeLabel(options.dateRange);
  if (rows.length === 0) {
    return formatOperationalAnswer({
      title: `${titleLabel.toUpperCase()} JOB SUMMARY`,
      direct: `There are no visible active ${label} jobs${rangeLabel} for your access level.`,
      suggestedActions: [
        `- Search latest service requests if you expected ${label} records.`,
        "- Confirm the implementation type spelling in the source ticket.",
      ],
    });
  }

  const totalMatches = Number(rows[0]?.totalMatches || rows.length);
  if (options.countOnly) {
    return formatOperationalAnswer({
      title: `${titleLabel.toUpperCase()} JOB SUMMARY`,
      direct: `There ${totalMatches === 1 ? "is" : "are"} ${totalMatches} visible active ${label} job${totalMatches === 1 ? "" : "s"}${rangeLabel}.`,
    });
  }
  const pendingCount = rows.filter(row => getRowStatus(row).toLowerCase() === "pending").length;
  const newCount = rows.filter(row => getRowStatus(row).toLowerCase() === "new").length;
  const assigneeCounts = rows.reduce((counts: Record<string, number>, row: any) => {
    const assignee = getRowAssignee(row);
    counts[assignee] = (counts[assignee] || 0) + 1;
    return counts;
  }, {});
  const assigneeBreakdown = (Object.entries(assigneeCounts) as Array<[string, number]>)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([assignee, count]) => `${assignee}: ${count}`)
    .join(", ");
  const details = rows.slice(0, 20).map(row => formatQueueItem(row));

  return formatOperationalAnswer({
    title: `${titleLabel.toUpperCase()} JOB SUMMARY`,
    direct: `There ${totalMatches === 1 ? "is" : "are"} ${totalMatches} visible active ${label} job${totalMatches === 1 ? "" : "s"}${rangeLabel}.`,
    breakdown: [
      `- Showing latest: ${rows.length}`,
      `- Pending in shown records: ${pendingCount}`,
      `- New in shown records: ${newCount}`,
      `- By assignee: ${assigneeBreakdown || "No assignee data"}`,
    ],
    details,
    suggestedActions: [
      `- Confirm schedule and vehicle details for the ${label} queue.`,
      "- Check duplicate customer/service issues before dispatch.",
      "- Balance assignments if one technician has too many active jobs.",
    ],
  });
}

function formatTicketLookup(ticketId: number, rows: any[]): string {
  if (rows.length === 0) {
    return `Ticket ID ${ticketId} was not found in records visible to your account.`;
  }
  const row = rows[0];
  return [
    `Ticket ID ${ticketId}`,
    "",
    `Customer: ${row.customerName || "Unknown customer"}`,
    `Status: ${getRowStatus(row)}`,
    `Assignee: ${getRowAssignee(row)}`,
    `Location: ${row.location || row.region || "No location"}`,
    `Description: ${getRowDescription(row)}`,
  ].join("\n");
}

function formatStatusLabelReport(statusLabel: string, rows: any[]): string {
  const totalMatches = Number(rows[0]?.totalMatches || rows.length);
  const displayLabel = statusLabel.replace(/\b\w/g, char => char.toUpperCase());
  if (rows.length === 0) {
    return `No visible ${displayLabel} tickets were found.`;
  }
  return [
    `${displayLabel.toUpperCase()} TICKET SUMMARY`,
    "",
    `Direct Answer: There are ${totalMatches} visible ${displayLabel} ticket${totalMatches === 1 ? "" : "s"}. Showing latest ${rows.length}.`,
    "",
    "Details:",
    ...rows.slice(0, 20).map(row => formatQueueItem(row, false, "lead")),
  ].join("\n");
}

function formatTicketListReport(title: string, rows: any[], options: { countOnly?: boolean; dateRange?: string; region?: string } = {}): string {
  const totalMatches = Number(rows[0]?.totalMatches || rows.length);
  const scopedTitle = `${title}${options.region ? ` in ${options.region}` : ""}${humanDateRangeLabel(options.dateRange)}`;
  if (rows.length === 0) {
    return formatOperationalAnswer({
      title: scopedTitle,
      direct: `No visible records found for ${scopedTitle}.`,
      suggestedActions: [
        "- Try a broader customer name, region, or issue keyword.",
        "- Check latest service requests if this is a recent ticket.",
      ],
    });
  }
  if (options.countOnly) {
    return formatOperationalAnswer({
      title: scopedTitle,
      direct: `Found ${totalMatches} visible record${totalMatches === 1 ? "" : "s"} for ${scopedTitle}.`,
    });
  }
  return formatOperationalAnswer({
    title: scopedTitle,
    direct: `Found ${totalMatches} visible record${totalMatches === 1 ? "" : "s"}. Showing latest ${rows.length}.`,
    details: rows.slice(0, 20).map(row => formatQueueItem(row)),
    suggestedActions: [
      "- Open the matching ticket IDs before dispatch or follow-up.",
      "- Check duplicate requests if the same customer appears multiple times.",
    ],
  });
}

function formatRegionTicketReport(region: string, rows: any[], options: { countOnly?: boolean; dateRange?: string; openOnly?: boolean; latest?: boolean } = {}): string {
  const totalMatches = Number(rows[0]?.totalMatches || rows.length);
  const label = options.openOnly ? "open ticket" : "ticket";
  const rangeLabel = humanDateRangeLabel(options.dateRange);
  if (rows.length === 0) {
    return `No visible ${label}s found in ${region}${rangeLabel}.`;
  }
  const direct = options.latest
    ? `Showing latest ${rows.length} visible ${region} ${label}${rows.length === 1 ? "" : "s"} out of ${totalMatches}${rangeLabel}.`
    : `${region} has ${totalMatches} visible ${label}${totalMatches === 1 ? "" : "s"}${rangeLabel}.`;
  if (options.countOnly) {
    return formatOperationalAnswer({ title: `${region.toUpperCase()} SERVICE SUMMARY`, direct });
  }
  return formatOperationalAnswer({
    title: `${region.toUpperCase()} SERVICE SUMMARY`,
    direct,
    details: rows.slice(0, 10).map(summarizeRow),
    suggestedActions: [
      `- Review ${region} open tickets before scheduling field visits.`,
      "- Balance technician workload by location where possible.",
    ],
  });
}

function formatIssueSummary(rows: any[], dateRange?: string): string {
  if (rows.length === 0) return formatOperationalAnswer({ direct: `No visible issue summary records found${humanDateRangeLabel(dateRange)}.` });
  const lines = rows.slice(0, 20).map(row => `${row.issue}: ${Number(row.totalRecords || 0)} total, ${Number(row.openRecords || 0)} open`);
  return formatOperationalAnswer({
    title: `Most common issues${humanDateRangeLabel(dateRange)}`,
    direct: `Found ${rows.length} issue pattern${rows.length === 1 ? "" : "s"} in visible records.`,
    details: lines,
    suggestedActions: [
      "- Prioritize high-volume open issue categories first.",
      "- Check repeated no-connection, ignition, and battery patterns before dispatch.",
    ],
  });
}

function formatTopCustomers(rows: any[], dateRange?: string): string {
  if (rows.length === 0) return formatOperationalAnswer({ direct: `No visible customer request summary records found${humanDateRangeLabel(dateRange)}.` });
  const lines = rows.slice(0, 20).map(row => `${row.customerName}: ${Number(row.totalRecords || 0)} total, ${Number(row.openRecords || 0)} open`);
  return formatOperationalAnswer({
    title: `Customers with most requests${humanDateRangeLabel(dateRange)}`,
    direct: `Found ${rows.length} high-activity customer${rows.length === 1 ? "" : "s"} in visible records.`,
    details: lines,
    suggestedActions: [
      "- Review the top customers for repeated service patterns.",
      "- Check duplicate requests before creating a new follow-up ticket.",
    ],
  });
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

function formatActionIntentAnswer(intent: SafeQueryIntent, params: Record<string, any>): string {
  const labels: Record<string, string> = {
    assignTicket: "assign a ticket",
    reassignTicket: "reassign a ticket",
    updateTicketStatus: "update a ticket status",
    deleteTicket: "delete a ticket",
    cancelTicket: "cancel a ticket",
    createLead: "create a lead",
    createServiceRequest: "create a service request",
    createMigrationTicket: "create a migration ticket",
    createInstallationTicket: "create an installation ticket",
  };
  const details = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `- ${key}: ${value}`);

  return [
    `Detected action intent: ${intent}`,
    "",
    `Direct Answer: I classified this as a request to ${labels[intent] || "perform a ticket action"}.`,
    "",
    "Execution: No database changes were made. The /api/chat/query endpoint is read-only and records action intents for evaluation only.",
    ...(details.length ? ["", "Extracted Parameters:", ...details] : []),
    "",
    "Next Step: Use the authenticated chat workflow or admin UI action to execute this change with confirmation.",
  ].join("\n");
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

async function initDB() {
  try {
    console.log("Ensuring database exists...");
    
    // Use the same config logic as src/db/index.ts
    const initConfig: any = {
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
    };

    let useSocket = false;
    if (process.env.DB_SOCKET && process.env.DB_SOCKET.trim() !== '') {
      try {
        if (fs.existsSync(process.env.DB_SOCKET)) {
          useSocket = true;
        } else {
          console.warn(`INIT DB: Socket path ${process.env.DB_SOCKET} provided but file does not exist. Falling back to TCP.`);
        }
      } catch (err) {
        console.warn(`INIT DB: Error checking socket path. Falling back to TCP.`);
      }
    }

    if (useSocket) {
      initConfig.socketPath = process.env.DB_SOCKET;
      console.log('INIT DB: Using socket:', initConfig.socketPath);
    } else {
      // Use 127.0.0.1 instead of localhost to force TCP
      initConfig.host = process.env.DB_HOST && process.env.DB_HOST !== 'localhost' ? process.env.DB_HOST : '127.0.0.1';
      initConfig.port = parseInt(process.env.DB_PORT || '3307');
      console.log('INIT DB: Using TCP:', initConfig.host, initConfig.port);
    }

    const initPool = mysql.createPool(initConfig);
    
    await initPool.execute(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'synohub'}\``);
    await initPool.end();

    console.log("Ensuring tables exist...");
    
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        contact_name VARCHAR(255),
        phone VARCHAR(50),
        email VARCHAR(255),
        region VARCHAR(100),
        implementation_type VARCHAR(100),
        vehicle_count INT DEFAULT 0
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS service_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        created_at VARCHAR(100),
        source VARCHAR(100),
        region VARCHAR(100),
        status VARCHAR(50) DEFAULT 'New Lead',
        implementation_type VARCHAR(100),
        customer_name TEXT,
        contact_name VARCHAR(255),
        phone VARCHAR(50),
        email VARCHAR(255),
        address TEXT,
        map_link TEXT,
        coordinates VARCHAR(100),
        new_qty INT DEFAULT 0,
        migrate_qty INT DEFAULT 0,
        trading_qty INT DEFAULT 0,
        service_qty INT DEFAULT 0,
        other_qty INT DEFAULT 0,
        accessories TEXT,
        requested_person VARCHAR(100),
        sales_person VARCHAR(100),
        sales_type VARCHAR(100),
        project_value VARCHAR(100),
        price_details TEXT,
        comment TEXT,
        issue_description TEXT,
        location VARCHAR(100),
        payment_status VARCHAR(50),
        amount VARCHAR(50),
        vehicle_details TEXT,
        notes TEXT,
        job_status VARCHAR(50) DEFAULT 'Pending'
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS salesplus_entries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        synohub_request_id INT,
        sales_plus_id INT DEFAULT 0,
        sales_plus_date VARCHAR(20),
        sales_plus_source VARCHAR(100),
        sales_plus_region VARCHAR(100),
        sales_plus_status VARCHAR(50),
        sales_plus_implementation_type VARCHAR(100),
        locator_plan VARCHAR(100),
        sales_plus_price VARCHAR(100),
        sales_plus_project_value VARCHAR(100),
        sales_plus_company_name TEXT,
        sales_plus_customer_name VARCHAR(255),
        sales_plus_phone VARCHAR(50),
        sales_plus_email VARCHAR(255),
        sales_plus_designation VARCHAR(255),
        sales_plus_address TEXT,
        sales_plus_address_map TEXT,
        sales_plus_address_coordinates VARCHAR(100),
        sales_plus_person VARCHAR(50),
        sales_plus_type VARCHAR(100),
        sales_plus_quantity_new INT DEFAULT 0,
        sales_plus_quantity_migrate INT DEFAULT 0,
        sales_plus_quantity_trading INT DEFAULT 0,
        sales_plus_quantity_service INT DEFAULT 0,
        sales_plus_quantity_others INT DEFAULT 0,
        sales_plus_supplier VARCHAR(255),
        sales_plus_accessories TEXT,
        sales_plus_comment TEXT,
        sales_plus_requested_by VARCHAR(50),
        schedule_note TEXT,
        schedule_phone VARCHAR(50),
        priority VARCHAR(50),
        clientName TEXT,
        itcUsername VARCHAR(255),
        itcPassword VARCHAR(255),
        projectImplementationType VARCHAR(100),
        leadType VARCHAR(100),
        tradeNumber VARCHAR(100),
        notes TEXT,
        create_new_nob INT DEFAULT 0,
        existing_customer INT DEFAULT 0,
        customer_id INT DEFAULT 0,
        additional_contact_details TEXT,
        synohub_requested_person VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      await pool.execute(`ALTER TABLE messages ADD COLUMN username VARCHAR(255) DEFAULT 'guest'`);
      console.log("Database table 'messages' verified with 'username' column.");
    } catch (columnErr) {
      // Column already exists, which is normal on subsequent boots
    }

    try {
      await pool.execute(`ALTER TABLE service_requests ADD COLUMN created_by VARCHAR(255) DEFAULT 'guest'`);
      console.log("Database table 'service_requests' verified with 'created_by' column.");
    } catch (err) {
      // Column already exists
    }

    try {
      await pool.execute(`ALTER TABLE customers ADD COLUMN created_by VARCHAR(255) DEFAULT 'guest'`);
      console.log("Database table 'customers' verified with 'created_by' column.");
    } catch (err) {
      // Column already exists
    }
    
    console.log("Database initialized.");
  } catch (e) {
    console.error("Database initialization failed:", (e as Error).message);
    // Don't throw here to allow the app to attempt starting anyway
  }
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

function parseIntSafe(value: any, fallback = 0): number {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSalesplusStatus(status: any): string {
  const raw = String(status || "New").trim();
  if (!raw || raw.toLowerCase() === "new lead") return "New";
  return raw;
}

function lookupSalesplusStaffId(name: any): string {
  const staffName = String(name || "").trim();
  if (!staffName) return "0";
  try {
    const configured = process.env.SALESPLUS_STAFF_IDS ? JSON.parse(process.env.SALESPLUS_STAFF_IDS) : {};
    const match = Object.entries(configured).find(([key]) => key.toLowerCase() === staffName.toLowerCase());
    if (match) return String(match[1]);
  } catch {
    console.warn("SALESPLUS_STAFF_IDS must be valid JSON, for example {\"Athul\":\"5\"}.");
  }
  return "0";
}

function buildSalesplusEntry(input: any, synohubRequestId: number, requestedPerson: string) {
  const status = normalizeSalesplusStatus(input.status || input.sales_plus_status);
  const implementationType = input.implementationType || input.implementation_type || input.sales_plus_implementation_type || "";
  const salesType = input.salesType || input.sales_type || input.sales_plus_type || "New";
  const companyName = input.customerName || input.customer_name || input.sales_plus_company_name || "";
  const contactName = input.contactName || input.contact_name || input.sales_plus_customer_name || companyName;
  const comment = input.comment || input.sales_plus_comment || "";
  const phone = input.phone || input.sales_plus_phone || "";
  const staffId = lookupSalesplusStaffId(requestedPerson || input.requestedPerson || input.requested_person);
  const isWon = status.toLowerCase() === "won";
  const isExisting = salesType.toLowerCase() === "existing";

  return {
    synohubRequestId,
    salesPlusId: parseIntSafe(input.sales_plus_id, 0),
    salesPlusDate: input.sales_plus_date || input.createdAt || new Date().toISOString().substring(0, 10),
    salesPlusSource: input.source || input.sales_plus_source || "Company Lead",
    salesPlusRegion: input.region || input.sales_plus_region || "",
    salesPlusStatus: status,
    salesPlusImplementationType: implementationType,
    locatorPlan: input.locatorPlan || input.locator_plan || "",
    salesPlusPrice: input.priceDetails || input.price_details || input.sales_plus_price || "",
    salesPlusProjectValue: input.projectValue || input.project_value || input.sales_plus_project_value || "",
    salesPlusCompanyName: companyName,
    salesPlusCustomerName: contactName,
    salesPlusPhone: phone,
    salesPlusEmail: input.email || input.sales_plus_email || "",
    salesPlusDesignation: input.designation || input.sales_plus_designation || "",
    salesPlusAddress: input.address || input.sales_plus_address || "",
    salesPlusAddressMap: input.mapLink || input.map_link || input.sales_plus_address_map || "",
    salesPlusAddressCoordinates: input.coordinates || input.sales_plus_address_coordinates || "",
    salesPlusPerson: staffId,
    salesPlusType: salesType,
    salesPlusQuantityNew: parseIntSafe(input.newQty || input.new_qty || input.sales_plus_quantity_new, 0),
    salesPlusQuantityMigrate: parseIntSafe(input.migrateQty || input.migrate_qty || input.sales_plus_quantity_migrate, 0),
    salesPlusQuantityTrading: parseIntSafe(input.tradingQty || input.trading_qty || input.sales_plus_quantity_trading, 0),
    salesPlusQuantityService: parseIntSafe(input.serviceQty || input.service_qty || input.sales_plus_quantity_service, 0),
    salesPlusQuantityOthers: parseIntSafe(input.otherQty || input.other_qty || input.sales_plus_quantity_others, 0),
    salesPlusSupplier: input.supplier || input.sales_plus_supplier || "",
    salesPlusAccessories: input.accessories || input.sales_plus_accessories || "",
    salesPlusComment: comment,
    salesPlusRequestedBy: staffId,
    scheduleNote: input.schedule_note || comment,
    schedulePhone: input.schedule_phone || phone,
    priority: input.priority || "normal",
    clientName: input.clientName || companyName,
    itcUsername: input.itcUsername || "",
    itcPassword: input.itcPassword || "",
    projectImplementationType: input.projectImplementationType || implementationType,
    leadType: input.leadType || salesType,
    tradeNumber: input.tradeNumber || "",
    notes: input.notes || comment,
    createNewNob: isWon ? 1 : 0,
    existingCustomer: isExisting ? 1 : 0,
    customerId: parseIntSafe(input.customer_id || input.customerId, 0),
    additionalContactDetails: input.additional_contact_details || input.additionalContactDetails || "[]",
    synohubRequestedPerson: requestedPerson || "",
  };
}

async function saveLocalSalesplusEntry(input: any, synohubRequestId: number, requestedPerson: string) {
  const entry = buildSalesplusEntry(input, synohubRequestId, requestedPerson);
  await db.insert(salesplusEntries).values(entry);
  console.log(`[Salesplus Local] Saved mapped entry for SynoHub request #${synohubRequestId}.`);
}

async function findExistingCustomerForServiceRequest(fields: ForcedServiceRequestFields): Promise<any | null> {
  const phone = fields.phone.trim();
  const email = fields.email.trim();
  const customerName = fields.customerName.trim();

  if (phone) {
    const exactPhone = await db.select().from(customers).where(eq(customers.phone, phone)).limit(1);
    if (exactPhone[0]) return exactPhone[0];

    const normalizedInputPhone = normalizeComparablePhone(phone);
    if (normalizedInputPhone) {
      const allCustomers = await db.select().from(customers);
      const normalizedMatch = allCustomers.find(customer => normalizeComparablePhone(customer.phone || "") === normalizedInputPhone);
      if (normalizedMatch) return normalizedMatch;
    }
  }

  if (email) {
    const exactEmail = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
    if (exactEmail[0]) return exactEmail[0];
  }

  if (customerName) {
    const exactName = await db.select().from(customers).where(eq(customers.name, customerName)).limit(1);
    if (exactName[0]) return exactName[0];

    const fuzzyName = await db.select().from(customers).where(like(customers.name, `%${customerName}%`)).limit(1);
    if (fuzzyName[0]) return fuzzyName[0];
  }

  return null;
}

function validateForcedServiceRequestFields(fields: ForcedServiceRequestFields) {
  const missing: string[] = [];
  if (isMissingTemplateValue(fields.customerName) || fields.customerName === "Unknown") missing.push("Customer Name");
  if (isMissingTemplateValue(fields.phone)) missing.push("Contact Number");
  if (isMissingTemplateValue(fields.implementationType)) missing.push("Implementation Type");
  if (isMissingTemplateValue(fields.issueDescription)) missing.push("Description");
  if (isMissingTemplateValue(fields.location)) missing.push("Service Location");
  if (missing.length > 0) {
    throw Object.assign(new Error(`Missing required service request fields: ${missing.join(", ")}.`), { statusCode: 400 });
  }
}

async function saveForcedServiceRequestFromMessage(input: string, authUser: AuthUser): Promise<ForcedServiceRequestResult | null> {
  const parsed = parseForcedServiceRequest(input);
  if (!parsed) return null;

  const fields: ForcedServiceRequestFields = { ...parsed };
  if (authUser.role === "staff" && authUser.name.trim()) {
    fields.requestedPerson = authUser.name.trim();
  }
  validateForcedServiceRequestFields(fields);

  const matchedCustomer = await findExistingCustomerForServiceRequest(fields);
  let customerId = matchedCustomer?.id ? Number(matchedCustomer.id) : 0;
  let customerCreated = false;
  const region = extractRegionName(fields.location) || fields.location;

  if (!matchedCustomer) {
    const [customerResult]: any = await db.insert(customers).values({
      name: fields.customerName,
      contactName: fields.contactName,
      phone: fields.phone,
      email: fields.email,
      region,
      implementationType: fields.implementationType,
      vehicleCount: fields.quantity,
      createdBy: authUser.name.trim() || "guest",
    });
    customerId = Number(customerResult.insertId || 0);
    customerCreated = true;
  }

  const customerName = matchedCustomer?.name || fields.customerName;
  const salesType = matchedCustomer ? "Existing" : "New";
  const notes = [
    fields.preferredDateTime ? `Preferred Date/Time: ${fields.preferredDateTime}` : "",
    fields.driverNumber ? `Driver Number: ${fields.driverNumber}` : "",
  ].filter(Boolean).join("\n");

  const serviceInsert = {
    createdAt: new Date().toISOString().substring(0, 10),
    source: "WhatsApp",
    region,
    status: "New Lead",
    implementationType: fields.implementationType,
    customerName,
    contactName: fields.contactName,
    phone: fields.phone,
    email: fields.email,
    newQty: fields.quantity,
    accessories: fields.accessories,
    requestedPerson: fields.requestedPerson,
    salesPerson: fields.requestedPerson,
    salesType,
    comment: fields.issueDescription,
    issueDescription: fields.issueDescription,
    location: fields.location,
    paymentStatus: fields.paymentStatus,
    amount: fields.amount,
    projectValue: fields.amount,
    priceDetails: fields.amount,
    vehicleDetails: fields.vehiclePlate,
    notes,
    jobStatus: "Pending",
    createdBy: authUser.name.trim() || "guest",
  };

  const [serviceResult]: any = await db.insert(serviceRequests).values(serviceInsert);
  const serviceRequestId = Number(serviceResult.insertId || 0);

  let salesplusSaved = false;
  try {
    await saveLocalSalesplusEntry({
      ...serviceInsert,
      customerId,
      customer_id: customerId,
      customerName,
      newQty: fields.quantity,
      requestedPerson: fields.requestedPerson,
    }, serviceRequestId, fields.requestedPerson);
    salesplusSaved = true;
  } catch (salesplusErr) {
    console.error("Failed to save local Salesplus entry for forced service request:", salesplusErr);
  }

  const incompleteContactName = /^(mr|mrs|ms|miss|sir|madam)\.?$/i.test(fields.contactName.trim());
  const answer = [
    matchedCustomer
      ? "Existing customer found, so I linked the service request to that customer and saved it."
      : "No existing customer found, so I created a new customer and saved the service request.",
    "",
    `Request ID: ${serviceRequestId}`,
    `Customer: ${customerName}`,
    fields.contactName ? `Contact Person: ${fields.contactName}${incompleteContactName ? " (incomplete in request)" : ""}` : "",
    `Phone: ${fields.phone}`,
    fields.driverNumber ? `Driver Phone: ${fields.driverNumber}` : "",
    `Type: ${fields.implementationType}`,
    `Issue: ${fields.issueDescription}`,
    fields.vehiclePlate ? `Plate: ${fields.vehiclePlate}` : "",
    `Quantity: ${fields.quantity}`,
    `Location: ${fields.location}`,
    incompleteContactName ? "Note: The contact person field was saved as provided because the full name was missing from the request." : "",
  ].filter(Boolean).join("\n");

  return {
    answer,
    customerMatched: Boolean(matchedCustomer),
    customerCreated,
    customerId,
    serviceRequestId,
    salesplusSaved,
    fields: {
      ...fields,
      customerName,
    },
  };
}

async function handleAIRecordSave(reply: string, userRole: string = "guest", userName: string = ""): Promise<{ reply: string; savedRecord?: any }> {
  // 1. Process [[DELETE_RECORD:...]]
  const deleteMatch = reply.match(/\[{1,2}DELETE_RECORD:(.*?)\]{1,2}/s);
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
          reply: reply.replace(deleteMatch[0], "").trim() + `\n\n(Authorization Warning: Access Denied. Only system administrators can delete records.)`
        };
      }

      let rawJson = deleteMatch[1].trim();
      const firstBrace = rawJson.indexOf("{");
      const lastBrace = rawJson.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1) {
        rawJson = rawJson.substring(firstBrace, lastBrace + 1);
      }
      const record = JSON.parse(rawJson);
      const id = parseInt(record.id);
      console.log(`[AI Auto-Delete] Detected record: ${record.type}, ID: ${id}`);
      if (record.type === "registration") {
        await db.delete(serviceRequests).where(eq(serviceRequests.id, id));
        return {
          reply: reply.replace(deleteMatch[0], "").trim() + `\n\n(CRM: Registration record #${id} deleted successfully by Admin.)`
        };
      } else if (record.type === "service") {
        await db.delete(serviceRequests).where(eq(serviceRequests.id, id));
        return {
          reply: reply.replace(deleteMatch[0], "").trim() + `\n\n(CRM: Service ticket record #${id} deleted successfully by Admin.)`
        };
      } else if (record.type === "customer") {
        await db.delete(customers).where(eq(customers.id, id));
        return {
          reply: reply.replace(deleteMatch[0], "").trim() + `\n\n(CRM: Customer account record #${id} deleted successfully by Admin.)`
        };
      }
    } catch (e) {
      console.error("AI Auto-Delete failed:", e);
    }
  }

  // 2. Process [[UPDATE_RECORD:...]]
  const updateMatch = reply.match(/\[{1,2}UPDATE_RECORD:(.*?)\]{1,2}/s);
  if (updateMatch) {
    try {
      if (userRole === "guest") {
        return {
          reply: reply.replace(updateMatch[0], "").trim() + `\n\n(Authorization Warning: Access Denied. Public guest users cannot update records.)`
        };
      }

      let rawJson = updateMatch[1].trim();
      const firstBrace = rawJson.indexOf("{");
      const lastBrace = rawJson.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1) {
        rawJson = rawJson.substring(firstBrace, lastBrace + 1);
      }
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
          reply: reply.replace(updateMatch[0], "").trim() + `\n\n(CRM: Registration #${id} updated successfully.)`
        };
      } else if (record.type === "service") {
        const mappedData = mapInputToSchema(record.data);
        await db.update(serviceRequests).set(mappedData).where(eq(serviceRequests.id, id));
        return {
          reply: reply.replace(updateMatch[0], "").trim() + `\n\n(CRM: Service ticket #${id} updated successfully.)`
        };
      } else if (record.type === "customer") {
        if (userRole !== "admin") {
          return {
            reply: reply.replace(updateMatch[0], "").trim() + `\n\n(Authorization Warning: Access Denied. Only system administrators can edit customer accounts.)`
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
          reply: reply.replace(updateMatch[0], "").trim() + `\n\n(CRM: Customer account #${id} updated successfully.)`
        };
      }
    } catch (e) {
      console.error("AI Auto-Update failed:", e);
    }
  }

  // 3. Process [[SAVE_RECORD:...]]
  const saveMatch = reply.match(/\[{1,2}SAVE_RECORD:(.*?)\]{1,2}/s);
  if (!saveMatch) return { reply };

  try {
    let rawJson = saveMatch[1].trim();
    const firstBrace = rawJson.indexOf("{");
    const lastBrace = rawJson.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) {
      rawJson = rawJson.substring(firstBrace, lastBrace + 1);
    }
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
        const customerName = mapped.customerName || "Unknown";
        if (customerName && customerName !== "Unknown") {
          const existing = await db.select().from(customers).where(eq(customers.name, customerName));
          const totalQty = parseInt(mapped.newQty || 1);
          if (existing.length === 0) {
            await db.insert(customers).values({
              name: customerName,
              contactName: mapped.contactName || "",
              phone: mapped.phone || "",
              email: mapped.email || "",
              region: mapped.region || "",
              implementationType: mapped.implementationType || "",
              vehicleCount: totalQty,
              createdBy: userName || 'guest'
            });
            console.log(`[AI Auto-Save] Synchronized customer ${customerName} into customers table.`);
          } else {
            const currentCount = existing[0].vehicleCount || 0;
            await db.update(customers)
              .set({ vehicleCount: currentCount + totalQty })
              .where(eq(customers.name, customerName));
            console.log(`[AI Auto-Save] Updated existing customer ${customerName} vehicleCount to ${currentCount + totalQty}`);
          }
        }
      } catch (custErr) {
        console.error("Failed to auto-sync customer:", custErr);
      }

      return {
        reply: reply.replace(saveMatch[0], "").trim() + `\n\n(CRM: Registration saved successfully. ID: ${res.insertId})`,
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
        reply: reply.replace(saveMatch[0], "").trim() + `\n\n(CRM: Service ticket ${ticketId} created successfully.)`,
        savedRecord: { ...record, id: res.insertId, ticketId }
      };
    }
    return { reply: reply.replace(saveMatch[0], "").trim() };
  } catch (pErr) {
    console.error("Failed to parse or save AI record:", pErr);
    return {
      reply: reply.replace(saveMatch[0], "").trim() + "\n\n(System: Failed to auto-save record. Please try manual entry.)"
    };
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;
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
      const authUser = getAuthUser(req);
      const userRole = authUser.role;
      const userName = normalizeUserName(authUser.name);

      const allCustomers = await db.select().from(customers);
      let allRequests = await db.select().from(serviceRequests);

      // Filtering based on Security Role and userName
      let filteredCustomers = allCustomers;
      if (userRole === "guest") {
        allRequests = allRequests.filter(r => {
          const createdByVal = (r.createdBy || "").trim().toLowerCase();
          return createdByVal === userName;
        });
        filteredCustomers = allCustomers.filter(c => {
          const createdByVal = (c.createdBy || "").trim().toLowerCase();
          return createdByVal === userName;
        });
      } else if (userRole === "staff" && userName) {
        allRequests = allRequests.filter(r => {
          const reqPerson = (r.requestedPerson || "").trim().toLowerCase();
          const salesPerson = (r.salesPerson || "").trim().toLowerCase();
          const createdByVal = (r.createdBy || "").trim().toLowerCase();
          return reqPerson === userName || salesPerson === userName || createdByVal === userName;
        });
        
        // Filter customer records to only the ones they are dealing with
        const myCustomerNames = new Set(allRequests.map(r => (r.customerName || "").trim().toLowerCase()));
        filteredCustomers = allCustomers.filter(c => {
          const cName = (c.name || "").trim().toLowerCase();
          const cCreatedBy = (c.createdBy || "").trim().toLowerCase();
          return myCustomerNames.has(cName) || cCreatedBy === userName;
        });
      }

      // Map requests for lead registrations tab
      const allRegistrations = allRequests.map(r => ({
        id: r.id,
        customerName: r.customerName || "",
        contactName: r.contactName || "",
        designation: r.requestedPerson || "",
        phone: r.phone || "",
        email: r.email || "",
        region: r.region || "",
        address: r.address || "",
        mapLink: r.mapLink || "",
        coordinates: r.coordinates || "",
        source: r.source || "",
        status: r.status || "New Lead",
        implementationType: r.implementationType || "",
        salesPerson: r.salesPerson || "",
        salesType: r.salesType || "",
        requestedPerson: r.requestedPerson || "",
        comment: r.comment || "",
        projectValue: r.projectValue ? r.projectValue.toString() : "",
        priceDetails: r.priceDetails || "",
        accessories: r.accessories || "",
        newQty: r.newQty || 0,
        migrateQty: r.migrateQty || 0,
        tradingQty: r.tradingQty || 0,
        serviceQty: r.serviceQty || 0,
        otherQty: r.otherQty || 0,
        createdAt: r.createdAt
      }));

      // Map requests for technical services queue tab
      const allServices = allRequests.map(s => ({
        id: s.id,
        ticketId: s.id ? ("TKT-" + s.id) : "",
        customerName: s.customerName || "",
        description: s.issueDescription || s.notes || s.comment || "",
        status: s.jobStatus || "Pending",
        quantity: (s.newQty || 0) + (s.migrateQty || 0) + (s.tradingQty || 0) + (s.serviceQty || 0) + (s.otherQty || 0) || 1,
        requestedPerson: s.requestedPerson || "",
        payment: s.paymentStatus || "",
        invoiceStatus: s.paymentStatus === "PAID" ? "Invoiced" : "Not Invoiced",
        paymentStatus: s.paymentStatus || "",
        amount: s.amount ? s.amount.toString() : "",
        assignee: s.salesPerson || s.requestedPerson || "",
        createdAt: s.createdAt,
        location: s.location || s.region || ""
      }));

      res.json({ registrations: allRegistrations, services: allServices, customers: filteredCustomers });
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
      const body = req.body;
      const authUser = getAuthUser(req);
      const userRole = authUser.role;
      const userName = authUser.name.trim();

      let reqPerson = body.requestedPerson || body.requested_person || "";
      if (userRole === "staff" && userName) {
        reqPerson = userName;
      }

      const [result] = await db.insert(serviceRequests).values({
        customerName: body.customerName || body.customer_name || "",
        contactName: body.contactName || body.contact_name || "",
        phone: body.phone || "",
        email: body.email || "",
        region: body.region || "",
        address: body.address || "",
        mapLink: body.mapLink || body.map_link || "",
        coordinates: body.coordinates || "",
        source: body.source || "",
        status: body.status || 'New Lead',
        implementationType: body.implementationType || body.implementation_type || "",
        salesPerson: body.salesPerson || body.sales_person || "",
        salesType: body.salesType || body.sales_type || "",
        requestedPerson: reqPerson,
        comment: body.comment || "",
        projectValue: body.projectValue || body.project_value || "",
        priceDetails: body.priceDetails || body.price_details || "",
        accessories: body.accessories || "",
        newQty: parseInt(body.newQty || body.new_qty || 0),
        migrateQty: parseInt(body.migrateQty || body.migrate_qty || 0),
        tradingQty: parseInt(body.tradingQty || body.trading_qty || 0),
        serviceQty: parseInt(body.serviceQty || body.service_qty || 0),
        otherQty: parseInt(body.otherQty || body.other_qty || 0),
        jobStatus: 'Pending',
        createdAt: new Date().toISOString().substring(0, 10),
        createdBy: userName || 'guest'
      });

      try {
        await saveLocalSalesplusEntry({ ...body, requestedPerson: reqPerson }, result.insertId, reqPerson);
      } catch (salesplusErr) {
        console.error("Failed to save local Salesplus entry:", salesplusErr);
      }

      // Synchronize lead customer to customers table
      try {
        const customerName = body.customerName || body.customer_name;
        if (customerName && customerName !== "Unknown") {
          const existing = await db.select().from(customers).where(eq(customers.name, customerName));
          const totalQty = parseInt(body.newQty || body.new_qty || 0) + 
                           parseInt(body.migrateQty || body.migrate_qty || 0) + 
                           parseInt(body.tradingQty || body.trading_qty || 0) + 
                           parseInt(body.serviceQty || body.service_qty || 0) + 
                           parseInt(body.otherQty || body.other_qty || 0);

          if (existing.length === 0) {
            await db.insert(customers).values({
              name: customerName,
              contactName: body.contactName || body.contact_name || "",
              phone: body.phone || "",
              email: body.email || "",
              region: body.region || "",
              implementationType: body.implementationType || body.implementation_type || "",
              vehicleCount: totalQty > 0 ? totalQty : 1,
              createdBy: userName || 'guest'
            });
            console.log(`[API Leads/New] Synchronized customer ${customerName} into customers table.`);
          } else {
            const currentCount = existing[0].vehicleCount || 0;
            await db.update(customers)
              .set({ vehicleCount: currentCount + totalQty })
              .where(eq(customers.name, customerName));
            console.log(`[API Leads/New] Updated existing customer ${customerName} vehicleCount to ${currentCount + totalQty}`);
          }
        }
      } catch (custErr) {
        console.error("API failed to sync customer:", custErr);
      }

      res.json({ success: true, id: result.insertId, message: 'Registration created' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Create service request
  app.post("/api/services", requireAuth, async (req, res) => {
    try {
      const body = req.body;
      const authUser = getAuthUser(req);
      const userRole = authUser.role;
      const userName = authUser.name.trim();

      let reqPerson = body.requestedPerson || body.requested_person || "";
      if (userRole === "staff" && userName) {
        reqPerson = userName;
      }

      const [result] = await db.insert(serviceRequests).values({
        customerName: body.customerName || body.customer_name || "",
        issueDescription: body.description || "",
        jobStatus: body.status || 'Pending',
        newQty: parseInt(body.quantity || 1),
        requestedPerson: reqPerson,
        paymentStatus: body.payment || body.paymentStatus || "",
        amount: body.amount || "",
        salesPerson: body.assignee || "",
        location: body.location || body.region || "",
        region: body.location || body.region || "",
        status: 'New Lead',
        createdAt: new Date().toISOString().substring(0, 10),
        createdBy: userName || 'guest'
      });
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

      const b = req.body;
      const custName = b.customerName || b.customer_name;
      
      await db.update(serviceRequests).set({
        customerName: custName,
        contactName: b.contactName || b.contact_name,
        phone: b.phone,
        email: b.email,
        region: b.region,
        address: b.address,
        mapLink: b.mapLink || b.map_link,
        coordinates: b.coordinates,
        source: b.source,
        status: b.status,
        implementationType: b.implementationType || b.implementation_type,
        salesPerson: b.salesPerson || b.sales_person,
        salesType: b.salesType || b.sales_type,
        requestedPerson: b.requestedPerson || b.requested_person,
        comment: b.comment,
        projectValue: b.projectValue || b.project_value,
        priceDetails: b.priceDetails || b.price_details,
        accessories: b.accessories,
        newQty: parseInt(b.newQty || b.new_qty || 0),
        migrateQty: parseInt(b.migrateQty || b.migrate_qty || 0),
        tradingQty: parseInt(b.tradingQty || b.trading_qty || 0),
        serviceQty: parseInt(b.serviceQty || b.service_qty || 0),
        otherQty: parseInt(b.otherQty || b.other_qty || 0)
      }).where(eq(serviceRequests.id, recordId));

      // Synchronize lead customer details to customers table on lead edit
      try {
        if (custName && custName !== "Unknown") {
          const existing = await db.select().from(customers).where(eq(customers.name, custName));
          const totalQty = parseInt(b.newQty || b.new_qty || 0) + 
                           parseInt(b.migrateQty || b.migrate_qty || 0) + 
                           parseInt(b.tradingQty || b.trading_qty || 0) + 
                           parseInt(b.serviceQty || b.service_qty || 0) + 
                           parseInt(b.otherQty || b.other_qty || 0);

          if (existing.length === 0) {
            await db.insert(customers).values({
              name: custName,
              contactName: b.contactName || b.contact_name || "",
              phone: b.phone || "",
              email: b.email || "",
              region: b.region || "",
              implementationType: b.implementationType || b.implementation_type || "",
              vehicleCount: totalQty > 0 ? totalQty : 1
            });
            console.log(`[API Leads/Edit] Created synchronized customer ${custName} on lead edit.`);
          } else {
            await db.update(customers)
              .set({ 
                contactName: b.contactName || b.contact_name || existing[0].contactName,
                phone: b.phone || existing[0].phone,
                email: b.email || existing[0].email,
                region: b.region || existing[0].region,
                implementationType: b.implementationType || b.implementation_type || existing[0].implementationType,
                vehicleCount: totalQty > 0 ? totalQty : existing[0].vehicleCount
              })
              .where(eq(customers.name, custName));
            console.log(`[API Leads/Edit] Synchronized existing customer ${custName} details.`);
          }
        }
      } catch (custErr) {
        console.error("API failed to sync customer on update:", custErr);
      }

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

      await db.delete(serviceRequests).where(eq(serviceRequests.id, parseInt(id)));
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

      const b = req.body;
      await db.update(serviceRequests).set({
        customerName: b.customerName,
        issueDescription: b.description,
        jobStatus: b.status,
        newQty: parseInt(b.quantity || 1),
        requestedPerson: b.requestedPerson,
        paymentStatus: b.payment,
        amount: b.amount,
        salesPerson: b.assignee,
        location: b.location
      }).where(eq(serviceRequests.id, recordId));
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

      await db.delete(serviceRequests).where(eq(serviceRequests.id, parseInt(id)));
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

      await db.insert(messages).values({
        role: "user",
        content: message,
        username: chatChannel,
      });

      const forcedServiceRequest = await saveForcedServiceRequestFromMessage(message, authUser);
      if (forcedServiceRequest) {
        await db.insert(messages).values({
          role: "assistant",
          content: cleanVisibleAssistantText(forcedServiceRequest.answer),
          username: chatChannel,
        });

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
        const winnerDetected = validateQueryIntent(providerToDetected(providers[winner]));
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

        await db.insert(messages).values({
          role: "assistant",
          content: answer,
          username: chatChannel,
        });

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
      const detected = validateQueryIntent(providerChoice.detected);
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

      await db.insert(messages).values({
        role: "assistant",
        content: answer,
        username: chatChannel,
      });

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
        await db.insert(messages).values({
          role: "assistant",
          content: answer,
          username: getModeScopedChatChannel(chatIdentity.channel, aiMode),
        });
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

      const persistedHistory = await db.select().from(messages)
        .where(eq(messages.username, chatChannel))
        .orderBy(desc(messages.timestamp))
        .limit(12);
      const chatHistory = persistedHistory
        .reverse()
        .map((h: any) => ({ role: h.role, content: h.content }));

      // Save user message (partitioned by username)
      await db.insert(messages).values({ 
        role: 'user', 
        content: message,
        username: chatChannel
      });

      const forcedServiceRequest = await saveForcedServiceRequestFromMessage(message, authUser);
      if (forcedServiceRequest) {
        const reply = cleanVisibleAssistantText(forcedServiceRequest.answer);
        await db.insert(messages).values({
          role: "assistant",
          content: reply,
          username: chatChannel,
        });

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
        await db.insert(messages).values({
          role: "assistant",
          content: reply,
          username: chatChannel,
        });
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

          await db.insert(messages).values({ 
            role: 'assistant', 
            content: guestReply,
            username: chatChannel
          });
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
          await db.insert(messages).values({ 
            role: 'assistant', 
            content: deniedMessage,
            username: chatChannel
          });
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

          await db.insert(messages).values({ 
            role: 'assistant', 
            content: pendingReply,
            username: chatChannel
          });
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

          await db.insert(messages).values({ 
            role: 'assistant', 
            content: latestReply,
            username: chatChannel
          });
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
        if (fs.existsSync(promptsPath)) {
          const fileData = JSON.parse(fs.readFileSync(promptsPath, "utf8"));
          currentPrompts = { ...currentPrompts, ...fileData };
        }
      } catch (err) {
        console.error("Failed to load prompts dynamically, using in-memory defaults:", err);
      }

      let systemInstruction = `${currentPrompts.chat_assistant}

${dbContextStr}
`;

      if (userRole === "staff") {
        systemInstruction += `
=== STAFF SESSION IDENTITY ===
- The logged-in staff user is "${userName}".
- Treat "${userName}" as the active staff member, requester, requested person, and owner of this chat session.
- If this staff user creates a lead registration or service ticket, default requestedPerson/requested_person/sales_person/assignee to "${userName}" unless the user explicitly names a different valid staff member.
- Do NOT ask "who is the requested person" for staff users just because a new request starts. The requested person is already known from the login: "${userName}".
- If the staff user asks for "pending request", "pending requests", "my pending", "open request", or similar, interpret it as a request to list/view their current pending/open records from CURRENT CRM DATABASE RECORDS. Do NOT treat that phrase as a request to create a new ticket.
- If the staff user asks for "latest records", "latest 10 records", "recent records", or similar, list only records visible in CURRENT CRM DATABASE RECORDS for "${userName}".
- Never invent sample/historical records and never mention records assigned to other staff members. If CURRENT CRM DATABASE RECORDS has no visible matches, say there are no visible records for "${userName}".
- When listing records, only use records visible in CURRENT CRM DATABASE RECORDS and keep the answer concise with IDs, customer names, status, and description/location when available.
`;
      }

      if (userRole === "guest") {
        systemInstruction += `
=== GUEST ROLE SECURITY CONSTRAINTS ===
- You are interacting with a GUEST user (UserName: "${userName}").
- GUEST users can create records, but they are STRICTLY RESTRICTED to viewing only records created by themselves.
- Under NO circumstances can you show, describe, or summarize records of other users, technician workloads, or system-wide summaries.
- If the guest user asks to view all records, all customers, all tickets, database summaries, technician workloads, or records created by other users (e.g. Athul), you MUST respond exactly with: "Access Restricted: You can only view records created by your account." and then list only the records that are present in CURRENT CRM DATABASE RECORDS (which have already been filtered to their own records).
- Be polite, and keep the user's focus on creating new records or managing their own submitted items.
`;
      }

      systemInstruction += `
CRITICAL FLUID CONVERSATION & INTELLIGENT MATCHING RULES:
1. ACT HUMAN & OPERATIONAL: Reply like a human sales or fleets officer in Dubai of Synosys Fleet Intelligence. Keep conversations natural, friendly, highly custom, and warm. Use phrases like "Oh, let me look that up!", "Great, Vishnu!", or "Welcome back."
2. DYNAMIC LOOKUP, MATCH CLARIFICATION & NEW CUSTOMER CHECK (CRITICAL):
   - When a user enters a customer or company name (such as "klee", "kleemol", "crescent", "clymate"), check the lists of active CRM Customers, Lead Registrations, and Services in the CURRENT CRM DATABASE RECORDS above.
   - If the name provided is only a partial match (e.g. they entered "klee" or "kleemol" which might match "KLEEMOL CAR RENTAL", or any abbreviation or partial spelling), you MUST NOT immediately assume they mean that existing customer. You MUST explicitly ask a clarification or confirmation question to find out if they are referring to that existing entity, or if this is a completely brand-new customer with a similar name.
   - If there are MULTIPLE similar/matching records in the database (e.g. searching for "Clymate" or "Clymet" matches Clymate Logistics, Clymate Technical Services, Clymate Transport, etc., or multiple branches of Inspirentals), STOP immediately. Do NOT register or default to a single choice, and do NOT output a SAVE block yet.
   - You MUST dynamically parse the active database context, list the ACTUAL matching records clearly with their details (database ID, customer name, region, and location if available), and ask the user to clarify which specific search result they mean, or if they are registering a brand-new entity entirely.
   - Example format you should use for listing live matches:
     "I searched our database and found a few active accounts matching 'Clymate'. Could you please clarify which of these accounts you are asking about, or if we should register a brand-new entity?
     - Clymate Logistics (ID: #1001, Region: Dubai, Location: DIP)
     - Clymate Logistics (ID: #1002, Region: Abu Dhabi, Location: KIZAD)
     - Clymate Technical Services (ID: #1003, Region: Abu Dhabi, Location: Musaffah)
     - Clymate Transport (ID: #1004, Region: Dubai, Location: Al Quoz)"
   - Always list the REAL matching records found in CURRENT CRM DATABASE RECORDS. Do not invent simulated entries if they are not in the context string.
3. MANDATORY ALIGNED KEY-VALUE DISPLAY FORMAT:
   - When representing, summarizing, displaying, or confirming any Lead Registration or Service Ticket record (whether creating or updating), you MUST output exactly this aligned block format:
     Service Type       : [Service / Implementation Type here, e.g. LOCATOR]
     Customer Name      : [Contact Name here] | [Customer Name here]
     Contact Number     : [Phone number here]
     Quantity           : [Quantity of devices here, e.g. 1]
     Payment            : [PAID/Pending/Not Applicable here]
     Amount             : [Amount here if any]
     Location           : [Location/Region here, e.g. Abu Dhabi]
     Description        : [Description of issue here, e.g. No Connection]
4. CONVERSATIONAL FILLING & STEP-BY-STEP INFORMATION GATHERING:
   - Real humans type in fragments. If they request to file, create, save, or register something but essential details (specifically: contact phone number, location region, device quantity, status, or implementation type) are missing, do NOT output a trigger tag.
   - Instead, reply instantly with human warmth and ask for the missing details step-by-step.
   - Phrases like "pending request", "pending requests", "my pending", and "open request" are lookup/listing intents, not creation intents. Search CURRENT CRM DATABASE RECORDS and answer with matching visible records.
5. TRIGGER SAVE FORMAT:
   When you do have sufficient details (such as customer name, contact phone, region, status: "New Lead", salesType: "New" or "Existing", and quantity), output your friendly reply followed by the TRIGGER BLOCK at the very end. The trigger block MUST use exactly this format:
   [[SAVE_RECORD:{"type":"registration","customerName":"...","contactName":"...","phone":"...","email":"...","region":"...","implementationType":"...","status":"New Lead","salesType":"Existing","requestedPerson":"...","comment":"...","qty":1}]]
   OR if it is a service ticket save:
   [[SAVE_RECORD:{"type":"service","customerName":"...","description":"...","assignee":"...","amount":"...","payment":"..."}]]
 6. DYNAMIC STAFF REGISTRATION, INTRODUCTIONS & NAME ANOMALIES (CRITICAL):
   - Under no circumstances should you treat a name introduction (such as "iam feros", "iaam sharnag", "i am athul", "this is nishad", etc.) as a standard generic greetings chat (do NOT reply with a basic "Hello Feros! How can I assist you today?" or default chatbot intro).
   - If the user introduces themselves with a name that is not in the original staff list (e.g., "feros" or "sharnag"), you must recognize that they are registering a brand-new staff coordinator. Acknowledge them warmly as a newly registered fleet coordinator in Dubai, but let them know registration requires confirmation from their side (which is prompted in the user interface), and once confirmed, all subsequent requests/drafts in this session will default to them as the Requested Person.
   - ABSOLUTE PROHIBITION ON ASSIGNING UNREGISTERED STAFF AS REQUESTED PERSON: You are strictly forbidden from assigning, defaulting, mapping, or adding any person as the Requested Person if they are not in the active requested person list (the list of default allowed staff or dynamically registered and confirmed staff). Under no circumstances should you say "The requested person for this registration is you" or similar phrases for unregistered/unauthorized people (who are not in the requested handoff list). If the user asks "who are the requested person" or similar, you must list the allowed registered staff members from the allowed list: Ajmal, Amrutha, Athul, Celine, Deepak, Faizal, Ivy, Midhun, Mohamed Musthafa, Naseeb, Nishad, Rasick, Reyn, Shamnad, Shams, Shyamjith, or any dynamically confirmed and registered staff in the session.
   - If you asked who the requested person is, and they answer with any name (even if misspelled, new, or absent from the default list, such as "sharnag" or "feros"), you MUST accept it instantly without apologizing or asking for a retry. Do NOT say you don't recognize the name or ask them to choose again. Accept it as a newly registered staff member/coordinator, output a success confirmation, complete the draft record by mapping that name strictly to "requested_person", display the completed record in the aligned key-value format, and output the corresponding [[SAVE_RECORD:...]] block.
7. SINGLE STAFF NAME ANSWERS CONTEXT PRESERVATION (CRITICAL):
   - Under no circumstances should you treat a single staff member's name (e.g. "Athul", "Celine", "Nishad", "Midhun", "Faizal", "Rasick", "Shamnad", etc.) as a generic greeting or introduction (e.g. do NOT say "Hello Athul! How can I assist you today?" or "Nice to meet you").
   - If you asked the user to specify who requested the ticket/lead (the staff/Requested Person), and they reply with a name from the allowed staff list (such as "athul"), you MUST recognize that they are providing the requested_person or sales_person for the CRM ticket or registration currently being drafted in the chat history.
   - Do NOT reset the conversation or lose context. Proceed immediately to complete the draft ticket or lead registration, map the provided name to "requested_person", display the finalized ticket details in the mandatory aligned key-value format block (with unbolded text, i.e., NO double asterisks "**"), and append the complete corresponding [[SAVE_RECORD:...]] block.
8. NEW SESSION/REQUEST STAFF NAME CLARIFICATION (EXPLICIT SESSIONS OVER COLD CARRIES):
   - When a new chat message arrives initiating a separate request, or when a user begins a completely new service ticket or lead registration task, you MUST NOT implicitly carry over the 'Requested Person' from a previous conversation task or from history for admin or guest users.
   - For example, if a previous service ticket was requested by "Athul", and now the user has started a new request (e.g., "create a service for customer crescent tomorrow"), do NOT default or assume that the requested person is "Athul" again.
   - For STAFF users, this clarification rule is overridden by STAFF SESSION IDENTITY above: use the logged-in staff member as the Requested Person automatically.
   - For admin or guest users only, explicitly ask who requested the ticket unless they provide the staff name within the prompt.
`;
      const localSystemInstruction = buildLocalLlmSystemInstruction(systemInstruction);

      const stripRecordTriggers = (text: string): string => {
        return text
          .replace(/\[{1,2}(?:SAVE_RECORD|UPDATE_RECORD|DELETE_RECORD):.*?\]{1,2}/gs, "")
          .trim();
      };

      const formatCompareChatReply = (text: string): string => {
        return stripRecordTriggers(text)
          .replace(/^\s*Assistant:\s*/i, "")
          .replace(/^.*\b(?:saving|save|created successfully|registered successfully)\b.*$/gim, "")
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/\*([^*\n:]+)\*:/g, "$1:")
          .replace(/\*/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      };

      const sanitizeProviderChatHistory = () => {
        return chatHistory
          .map((h: any) => {
            const role = (h.role === "assistant" || h.role === "model") ? "assistant" : "user";
            const content = h.content || (h.parts && h.parts[0]?.text) || "";
            return { role, content: String(content).trim() } as { role: "user" | "assistant"; content: string };
          })
          .filter(h => {
            if (!h.content) return false;
            if (h.role !== "assistant") return true;
            if (/^\s*Compare Both result:/i.test(h.content)) return false;
            if (/^\s*(Gemini|Local LLM|NVIDIA|Nex AGI|GPT OSS 120B|Gemma|Cohere|OpenRouter)\s+\(\d+ms\)/im.test(h.content)) return false;
            return true;
          })
          .slice(-10);
      };

      const cleanLocalChatReply = (text: string): string => {
        return text
          .replace(/^\s*Assistant:\s*/i, "")
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/\*([^*\n:]+)\*:/g, "$1:")
          .replace(/\*/g, "")
          .replace(/\bChoose from the dropdown below\.?/gi, "")
          .replace(/\bfrom the dropdown below\.?/gi, "")
          .replace(/\bPlease fill in this information\b/gi, "Please share this information")
          .replace(/\n+\s*User:\s*[\s\S]*$/i, "")
          .replace(/\n+\s*Assistant:\s*[\s\S]*$/i, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      };

      const applyStaffRequestedPersonDefault = (text: string): string => {
        if (userRole !== "staff" || !userName) return text;
        const escapedName = userName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`Requested Person\\s*:\\s*${escapedName}\\b`, "i").test(text)) {
          return text;
        }
        return text
          .replace(/^(\s*[-•]?\s*Requested\s+(?:Person|by)\s*:\s*)$/gim, `$1${userName} (from staff login)`)
          .replace(/^(\s*[-•]?\s*Requested\s+(?:Person|by)\s*:\s*)(?:N\/A|TBD|Unknown|Not provided|Use the logged-in staff member when this is a staff session\.?)\s*$/gim, `$1${userName} (from staff login)`);
      };

      const formatLocalCompareReply = (text: string): string => {
        const cleaned = applyStaffRequestedPersonDefault(formatCompareChatReply(text));
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
          const cleanedHistory = sanitizeProviderChatHistory();

          let reply = "";
          if (genAI && cleanedGeminiKey) {
            const conversation = [
              ...cleanedHistory.map(h => `${h.role === "assistant" ? "Assistant" : "User"}: ${h.content}`),
              `User: ${message}`,
            ].join("\n\n");
            const response = await genAI.models.generateContent({
              model: geminiModel,
              contents: conversation,
              config: {
                systemInstruction,
              },
            });
            reply = response.text;
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

        let ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
        if (!ollamaUrl.endsWith("/api/chat")) {
          ollamaUrl = ollamaUrl.replace(/\/$/, "") + "/api/chat";
        }
        
        try {
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
              { role: "system", content: localSystemInstruction },
              ...sanitizeProviderChatHistory(),
              { role: "user", content: message }
            ],
            options: ollamaOptions,
            keep_alive: process.env.OLLAMA_KEEP_ALIVE || "5m",
            stream: false
          };

          if (!fallback) {
            console.log(`[AI Chat] Mode=local, using Ollama/local LLM: model=${requestBody.model}, options=${JSON.stringify(ollamaOptions)}`);
          } else {
            console.log(`[AI Chat] START Ollama fallback: model=${requestBody.model}, options=${JSON.stringify(ollamaOptions)}`);
          }
          
          const response = await axios.post(ollamaUrl, requestBody, { 
            timeout: 300000,
            validateStatus: () => true 
          });

          if (response.status !== 200) {
            throw new Error(`Ollama returned status ${response.status}`);
          }

          console.log(`[AI Chat] Ollama Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
          return {
            reply: response.data.message.content,
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
          const cleanedHistory = sanitizeProviderChatHistory();

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
          const cleanedHistory = sanitizeProviderChatHistory();

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
          console.error(`${openRouterPrimaryLabel} API failed:`, (providerErr as Error).message);
          return {
            reply: "",
            durationMs: Date.now() - startTime,
            error: (providerErr as Error).message,
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
          if (provider === "nvidia" && result.error && isOpenRouterPolicyEndpointError(result.error)) {
            console.warn(`${openRouterPrimaryLabel} is unavailable for this OpenRouter account/model policy in compare mode; using Local LLM fallback.`);
            const fallback = await runLocalChatReply(true);
            const fallbackNotice = [
              `${openRouterPrimaryLabel} is unavailable for the current OpenRouter model/account policy.`,
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

        await db.insert(messages).values({
          role: 'assistant',
          content: finalReply,
          username: chatChannel
        });

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
        reply = applyStaffRequestedPersonDefault(cleanLocalChatReply(reply));
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
      await db.insert(messages).values({ 
        role: 'assistant', 
        content: finalReply,
        username: chatChannel
      });
      
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
          history = await db.select().from(messages)
            .where(historyPredicateFor(chatIdentity.channel))
            .orderBy(messages.timestamp);
        } else {
          history = await db.select().from(messages)
            .where(historyPredicateFor("admin"))
            .orderBy(messages.timestamp);
        }
      } else {
        // Filter by username specifically
        const chatIdentity = resolveChatIdentity(authUser);
        history = await db.select().from(messages)
          .where(historyPredicateFor(chatIdentity.channel))
          .orderBy(messages.timestamp);
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
        if (fs.existsSync(promptsPath)) {
          const fileData = JSON.parse(fs.readFileSync(promptsPath, "utf8"));
          currentPrompts = { ...currentPrompts, ...fileData };
        }
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

startServer();

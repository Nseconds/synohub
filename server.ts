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
import mysql from "mysql2/promise";
import fs from "fs";

import { GoogleGenAI } from "@google/genai";

type UserRole = "admin" | "staff" | "guest";

interface AuthUser {
  sub: string;
  name: string;
  role: UserRole;
  iat: number;
  exp: number;
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

const cleanedGeminiKey = cleanEnvVar(process.env.GEMINI_API_KEY);

console.log("--- Environment Variable Sync Check ---");
console.log("OLLAMA_URL:", process.env.OLLAMA_URL);
console.log("OLLAMA_MODEL:", process.env.OLLAMA_MODEL);
console.log("OLLAMA_NUM_THREAD:", process.env.OLLAMA_NUM_THREAD);
console.log("OLLAMA_NUM_GPU:", process.env.OLLAMA_NUM_GPU);
console.log("GEMINI_API_KEY:", cleanedGeminiKey ? "PRESENT" : "MISSING");
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
  const fallback = {
    role: authUser.role,
    name: authUser.role === "guest" ? normalizeUserName(authUser.name) : authUser.name.trim(),
    channel: authUser.role === "admin"
      ? "admin"
      : authUser.role === "staff"
        ? `staff:${authUser.name.trim()}`
        : "guest",
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
  if (channel.startsWith("staff:")) {
    const staffName = channel.slice("staff:".length);
    return or(eq(messages.username, channel), eq(messages.username, staffName));
  }
  if (channel === "admin") {
    return or(eq(messages.username, "admin"), eq(messages.username, "Administrator"));
  }
  return eq(messages.username, channel);
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

  // Chat/AI endpoint
  app.post("/api/chat", requireAuth, async (req, res) => {
    try {
      const { message, history, selectedChatTarget, selectedUsername } = req.body;
      const authUser = getAuthUser(req);
      const chatIdentity = resolveChatIdentity(authUser, selectedChatTarget || selectedUsername);
      let userRole = chatIdentity.role;
      let userName = chatIdentity.name;
      const chatChannel = chatIdentity.channel;

      if (authUser.role === "admin" && chatChannel !== "admin") {
        return res.status(403).json({ error: "Admin can only view guest and staff chats. Switch to Admin chat to send messages." });
      }

      // Save user message (partitioned by username)
      await db.insert(messages).values({ 
        role: 'user', 
        content: message,
        username: chatChannel
      });

      // Guest security rules check
      let prependAccessRestricted = false;
      if (userRole === "guest") {
        const normalized = message.toLowerCase().trim();
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
          const deniedMessage = "Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator.";
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

          const pendingReply = pendingRows.length === 0
            ? `${userName}, I do not see any pending or open requests assigned to you right now.`
            : formatStaffRecordList(`Pending/open requests for ${userName}`, pendingRows);

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

          const latestReply = latestRows.length === 0
            ? `${userName}, I do not see any records linked to your staff account right now.`
            : formatStaffRecordList(`Latest ${latestRows.length} records for ${userName}`, latestRows);

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

      let replyReceived = false;
      let reply = "";

      // 1. Try Gemini first if available
      if (genAI) {
        try {
          console.log("[AI Chat] Using Gemini 3.5 API with rich live DB context...");
          
          // Format/clean history strictly for Gemini's alternating role requirements
          const cleanedHistory: any[] = [];
          if (Array.isArray(history)) {
            const rawMapped = history
              .map((h: any) => {
                const role = (h.role === "assistant" || h.role === "model") ? "model" : "user";
                const text = h.content || (h.parts && h.parts[0]?.text) || "";
                return { role, text: text.trim() };
              })
              .filter(h => h.text !== "");

            for (const item of rawMapped) {
              if (cleanedHistory.length === 0) {
                // First message in history must be 'user' to begin a chat session turn correctly
                if (item.role === "user") {
                  cleanedHistory.push({
                    role: "user",
                    parts: [{ text: item.text }]
                  });
                }
              } else {
                const prev = cleanedHistory[cleanedHistory.length - 1];
                if (prev.role === item.role) {
                  // Merge duplicate consecutive roles to maintain alternating order
                  prev.parts[0].text += "\n\n" + item.text;
                } else {
                  cleanedHistory.push({
                    role: item.role,
                    parts: [{ text: item.text }]
                  });
                }
              }
            }

            // To send a new message, the history must end with a 'model' message
            if (cleanedHistory.length > 0 && cleanedHistory[cleanedHistory.length - 1].role === "user") {
              cleanedHistory.pop();
            }
          }

          const chat = genAI.chats.create({
            model: "gemini-3.5-flash",
            history: cleanedHistory,
            config: {
              systemInstruction: systemInstruction,
            },
          });

          const startTime = Date.now();
          const result = await chat.sendMessage({ message: message });
          reply = result.text;
          
          console.log(`[AI Chat] Gemini Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
          replyReceived = true;
        } catch (geminiErr) {
          console.error("Gemini API failed, falling back to Ollama:", (geminiErr as Error).message);
        }
      }

      // 2. Default to Ollama if Gemini failed or was unavailable
      if (!replyReceived) {
        let ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
        if (!ollamaUrl.endsWith("/api/chat")) {
          ollamaUrl = ollamaUrl.replace(/\/$/, "") + "/api/chat";
        }
        
        try {
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

          const requestBody = {
            model: currentOllamaModel,
            messages: [
              { role: "system", content: systemInstruction },
              ...history,
              { role: "user", content: message }
            ],
            options: ollamaOptions,
            keep_alive: process.env.OLLAMA_KEEP_ALIVE || "5m",
            stream: false
          };

          console.log(`[AI Chat] START Ollama fallback: model=${requestBody.model}, options=${JSON.stringify(ollamaOptions)}`);
          
          const startTime = Date.now();
          const response = await axios.post(ollamaUrl, requestBody, { 
            timeout: 300000,
            validateStatus: () => true 
          });

          if (response.status !== 200) {
            throw new Error(`Ollama returned status ${response.status}`);
          }

          console.log(`[AI Chat] Ollama Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
          reply = response.data.message.content;
          replyReceived = true;
        } catch (ollamaErr) {
          console.error("Ollama connection failed:", (ollamaErr as Error).message);
          // Final fallback
          reply = "I'm the SynoHub AI Assistant. I detected a temporary delay in my local processor. How can I help you manage your fleet today?";
        }
      }

      // Process records using role & username permissions
      const savedResult = await handleAIRecordSave(reply, userRole, userName);

      let finalReply = savedResult.reply;
      if (prependAccessRestricted && !finalReply.startsWith("Access Restricted:")) {
        finalReply = "Access Restricted: You can only view records created by your account.\n\n" + finalReply;
      }

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

      let history;
      if (userRole === "admin") {
        // Admins can review a specific channel: admin, guest, or staff:<name>.
        const target = (req.query.target || req.query.username) as string | undefined;
        if (target) {
          const chatIdentity = resolveChatIdentity(authUser, target);
          history = await db.select().from(messages)
            .where(chatHistoryPredicates(chatIdentity.channel))
            .orderBy(messages.timestamp);
        } else {
          history = await db.select().from(messages)
            .where(chatHistoryPredicates("admin"))
            .orderBy(messages.timestamp);
        }
      } else {
        // Filter by username specifically
        const chatIdentity = resolveChatIdentity(authUser);
        history = await db.select().from(messages)
          .where(chatHistoryPredicates(chatIdentity.channel))
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
      if (genAI) {
        try {
          console.log("[AI Ingest] Using Gemini 3.5 API with log extractor prompt...");
          const startTime = Date.now();
          const response = await genAI.models.generateContent({
            model: "gemini-3.5-flash",
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
          console.error("Gemini API failed for log extraction, falling back to Ollama:", (geminiErr as Error).message);
        }
      }

      // 2. Fall back to Ollama if Gemini failed or was unavailable
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

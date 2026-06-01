import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { db, pool } from "./src/db";
import { customers, serviceRequests, messages } from "./src/db/schema";
import { eq, like, or } from "drizzle-orm";
import axios from "axios";
import crypto from "crypto";
import mysql from "mysql2/promise";
import fs from "fs";

import { GoogleGenAI } from "@google/genai";

console.log("--- Environment Variable Sync Check ---");
console.log("OLLAMA_URL:", process.env.OLLAMA_URL);
console.log("OLLAMA_MODEL:", process.env.OLLAMA_MODEL);
console.log("OLLAMA_NUM_THREAD:", process.env.OLLAMA_NUM_THREAD);
console.log("OLLAMA_NUM_GPU:", process.env.OLLAMA_NUM_GPU);
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "PRESENT" : "MISSING");
console.log("---------------------------------------");

// Initialize Gemini if key exists
let genAI: any = null;
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
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
    
    console.log("Database initialized.");
  } catch (e) {
    console.error("Database initialization failed:", (e as Error).message);
    // Don't throw here to allow the app to attempt starting anyway
  }
}

async function seed() {
  try {
    let csvPath = path.join(process.cwd(), "synohub_fleet_data.csv");
    if (!fs.existsSync(csvPath)) {
      csvPath = path.join(process.cwd(), "user_import.csv");
    }
    if (!fs.existsSync(csvPath)) {
      console.log("No synohub_fleet_data.csv or user_import.csv found, skipping seed.");
      return;
    }

    // Safety check: skip seeding if database is already populated
    try {
      const [cRows]: any = await pool.execute("SELECT COUNT(*) as count FROM customers");
      const [srRows]: any = await pool.execute("SELECT COUNT(*) as count FROM service_requests");
      const totalCount = (cRows[0]?.count || 0) + (srRows[0]?.count || 0);
      if (totalCount > 0) {
        console.log(`Database already contains ${totalCount} records. Skipping CSV seed step to preserve custom database entries.`);
        return;
      }
    } catch (checkErr) {
      console.log("Database empty check failed or table not found (proceeding to seed):", (checkErr as Error).message);
    }

    console.log(`Found CSV dataset at ${path.basename(csvPath)}. Truncating tables and seeding entire custom dataset...`);
    try {
      await pool.execute("TRUNCATE TABLE customers");
      await pool.execute("TRUNCATE TABLE service_requests");
    } catch (truncateErr) {
      console.log("Truncate error ignored (continuing with database loading):", (truncateErr as Error).message);
    }

    const csvContent = fs.readFileSync(csvPath, "utf8");
    const lines = csvContent.split(/\r?\n/);
    
    // Custom CSV parser to handle quotes and commas properly
    function parseCSVLine(line: string): string[] {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current);
      return result;
    }

    const customerMap = new Map<string, {
      name: string;
      contactName: string;
      phone: string;
      email: string;
      region: string;
      implementationType: string;
      vehicleCount: number;
    }>();

    const registrationValues: any[] = [];
    const serviceValues: any[] = [];

    // Skip the headers row-0 and start parsing from i=1
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const cols = parseCSVLine(line);
      if (cols.length < 13) continue;

      const recordId = cols[0].replace(/["']/g, '').trim();
      const type = cols[1].replace(/["']/g, '').trim();
      const customerOrEntity = cols[2].replace(/["']/g, '').trim();
      const contactPerson = cols[3].replace(/["']/g, '').trim();
      const phone = cols[4].replace(/["']/g, '').trim();
      const email = cols[5].replace(/["']/g, '').trim();
      const region = cols[6].replace(/["']/g, '').trim();
      const status = cols[7].replace(/["']/g, '').trim();
      const quantity = parseInt(cols[8].replace(/["']/g, '').trim()) || 0;
      const valueOrAmount = cols[9].replace(/["']/g, '').trim();
      const salesPersonOrAssignee = cols[10].replace(/["']/g, '').trim();
      const implementationOrDescription = cols[11].replace(/["']/g, '').trim();
      
      let createdAtValue = new Date();
      if (cols[12]) {
        const cleanDateStr = cols[12].replace(/["']/g, '').trim();
        const d = new Date(cleanDateStr);
        if (!isNaN(d.getTime())) {
          createdAtValue = d;
        }
      }

      // Track uniquely in customer map
      const cleanCustomerName = customerOrEntity;
      if (cleanCustomerName) {
        if (!customerMap.has(cleanCustomerName)) {
          customerMap.set(cleanCustomerName, {
            name: cleanCustomerName,
            contactName: contactPerson,
            phone: phone,
            email: email,
            region: region,
            implementationType: type === "LeadRegistration" ? implementationOrDescription : "Service Ticket",
            vehicleCount: quantity
          });
        } else {
          const current = customerMap.get(cleanCustomerName)!;
          current.vehicleCount += quantity;
          if (contactPerson) current.contactName = contactPerson;
          if (phone) current.phone = phone;
          if (email) current.email = email;
          if (region) current.region = region;
        }
      }

      if (type === "LeadRegistration") {
        registrationValues.push({
          customerName: customerOrEntity,
          contactName: contactPerson,
          phone: phone,
          email: email,
          region: region,
          status: status || 'New Lead',
          implementationType: implementationOrDescription,
          salesPerson: salesPersonOrAssignee,
          projectValue: valueOrAmount,
          newQty: quantity,
          createdAt: createdAtValue
        });
      } else if (type === "ServiceTicket") {
        serviceValues.push({
          ticketId: recordId,
          customerName: customerOrEntity,
          description: implementationOrDescription,
          status: status || 'New',
          quantity: quantity,
          amount: valueOrAmount,
          assignee: salesPersonOrAssignee,
          createdAt: createdAtValue
        });
      }
    }

    // Insert in batches of 50 records
    if (registrationValues.length > 0) {
      console.log(`Seeding ${registrationValues.length} registrations to service_requests...`);
      const mappedRegs = registrationValues.map(r => ({
        customerName: r.customerName || "",
        contactName: r.contactName || "",
        phone: r.phone || "",
        email: r.email || "",
        region: r.region || "",
        status: r.status || "New Lead",
        implementationType: r.implementationType || "",
        salesPerson: r.salesPerson || "",
        projectValue: r.projectValue || "",
        newQty: r.newQty || 0,
        createdAt: r.createdAt ? r.createdAt.toISOString().substring(0, 10) : new Date().toISOString().substring(0, 10)
      }));
      for (let i = 0; i < mappedRegs.length; i += 50) {
        const chunk = mappedRegs.slice(i, i + 50);
        await db.insert(serviceRequests).values(chunk);
      }
    }

    if (serviceValues.length > 0) {
      console.log(`Seeding ${serviceValues.length} services to service_requests...`);
      const mappedServices = serviceValues.map(s => ({
        customerName: s.customerName || "",
        issueDescription: s.description || "",
        jobStatus: s.status || "Pending",
        newQty: s.quantity || 1,
        amount: s.amount || "",
        salesPerson: s.assignee || "",
        createdAt: s.createdAt ? s.createdAt.toISOString().substring(0, 10) : new Date().toISOString().substring(0, 10)
      }));
      for (let i = 0; i < mappedServices.length; i += 50) {
        const chunk = mappedServices.slice(i, i + 50);
        await db.insert(serviceRequests).values(chunk);
      }
    }

    if (customerMap.size > 0) {
      const customersToInsert = Array.from(customerMap.values());
      console.log(`Seeding ${customersToInsert.length} summarized customers...`);
      for (let i = 0; i < customersToInsert.length; i += 50) {
        const chunk = customersToInsert.slice(i, i + 50);
        await db.insert(customers).values(chunk);
      }
    }

    console.log("Database initialized and loaded with raw CSV dataset successfully.");
  } catch (e) {
    console.error("CSV Seeding failed:", (e as Error).message);
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

async function handleAIRecordSave(reply: string): Promise<{ reply: string; savedRecord?: any }> {
  // 1. Process [[DELETE_RECORD:...]]
  const deleteMatch = reply.match(/\[{1,2}DELETE_RECORD:(.*?)\]{1,2}/s);
  if (deleteMatch) {
    try {
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
          reply: reply.replace(deleteMatch[0], "").trim() + `\n\n(CRM: Registration record #${id} deleted successfully.)`
        };
      } else if (record.type === "service") {
        await db.delete(serviceRequests).where(eq(serviceRequests.id, id));
        return {
          reply: reply.replace(deleteMatch[0], "").trim() + `\n\n(CRM: Service ticket record #${id} deleted successfully.)`
        };
      } else if (record.type === "customer") {
        await db.delete(customers).where(eq(customers.id, id));
        return {
          reply: reply.replace(deleteMatch[0], "").trim() + `\n\n(CRM: Customer account record #${id} deleted successfully.)`
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
      let rawJson = updateMatch[1].trim();
      const firstBrace = rawJson.indexOf("{");
      const lastBrace = rawJson.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1) {
        rawJson = rawJson.substring(firstBrace, lastBrace + 1);
      }
      const record = JSON.parse(rawJson);
      const id = parseInt(record.id);
      console.log(`[AI Auto-Update] Detected record update: ${record.type}, ID: ${id}`);
      
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
    console.log(`[AI Auto-Save] Detected record save: ${record.type}`);
    
    if (record.type === "registration") {
      const mapped = mapInputToSchema(record);
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
        otherQty: mapped.otherQty || 0
      });

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
              vehicleCount: totalQty
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
      const [res]: any = await db.insert(serviceRequests).values({
        customerName: mapped.customerName || "Unknown",
        issueDescription: mapped.issueDescription || "",
        jobStatus: mapped.jobStatus || "New",
        newQty: mapped.newQty || 1,
        requestedPerson: mapped.requestedPerson || "",
        paymentStatus: mapped.paymentStatus || "",
        amount: mapped.amount || "",
        salesPerson: mapped.salesPerson || ""
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

  try {
    await initDB();
    await seed();
  } catch (err) {
    console.error("Critical: Could not initialize database. App may fail.", err);
  }

  app.use(express.json());

  // --- API Routes ---

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Get all dashboard data
  app.get("/api/data", async (req, res) => {
    try {
      const allCustomers = await db.select().from(customers);
      const allRequests = await db.select().from(serviceRequests);

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

      res.json({ registrations: allRegistrations, services: allServices, customers: allCustomers });
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
  app.post("/api/leads/new", async (req, res) => {
    try {
      const body = req.body;
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
        requestedPerson: body.requestedPerson || body.requested_person || "",
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
        createdAt: new Date().toISOString().substring(0, 10)
      });

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
              vehicleCount: totalQty > 0 ? totalQty : 1
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
  app.post("/api/services", async (req, res) => {
    try {
      const body = req.body;
      const [result] = await db.insert(serviceRequests).values({
        customerName: body.customerName || body.customer_name || "",
        issueDescription: body.description || "",
        jobStatus: body.status || 'Pending',
        newQty: parseInt(body.quantity || 1),
        requestedPerson: body.requestedPerson || body.requested_person || "",
        paymentStatus: body.payment || body.paymentStatus || "",
        amount: body.amount || "",
        salesPerson: body.assignee || "",
        location: body.location || body.region || "",
        region: body.location || body.region || "",
        status: 'New Lead',
        createdAt: new Date().toISOString().substring(0, 10)
      });
      res.json({ success: true, id: result.insertId, ticket_id: result.insertId ? ("TKT-" + result.insertId) : "", message: 'Service ticket created' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Edit/Update lead registration
  app.put("/api/leads/:id", async (req, res) => {
    try {
      const { id } = req.params;
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
      }).where(eq(serviceRequests.id, parseInt(id)));

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
  app.delete("/api/leads/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(serviceRequests).where(eq(serviceRequests.id, parseInt(id)));
      res.json({ success: true, message: "Lead registration deleted" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Edit/Update service task
  app.put("/api/services/:id", async (req, res) => {
    try {
      const { id } = req.params;
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
      }).where(eq(serviceRequests.id, parseInt(id)));
      res.json({ success: true, message: "Service ticket updated successfully" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Delete service task
  app.delete("/api/services/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(serviceRequests).where(eq(serviceRequests.id, parseInt(id)));
      res.json({ success: true, message: "Service ticket deleted" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Edit/Update customer definition
  app.put("/api/customers/:id", async (req, res) => {
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
      res.json({ success: true, message: "Customer account updated successfully" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Delete customer definition
  app.delete("/api/customers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(customers).where(eq(customers.id, parseInt(id)));
      res.json({ success: true, message: "Customer account deleted" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Customer search
  app.get("/api/customers", async (req, res) => {
    try {
      const q = req.query.q as string;
      const results = q 
        ? await db.select().from(customers).where(or(like(customers.name, `%${q}%`), like(customers.contactName, `%${q}%`)))
        : await db.select().from(customers);
      res.json({ results, total: results.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Chat/AI endpoint
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history } = req.body;
      
      // Save user message
      await db.insert(messages).values({ role: 'user', content: message });

      // Fetch live DB Context
      const allCustomers = await db.select().from(customers);
      const allRequests = await db.select().from(serviceRequests);

      // Map requests for lead registrations context description
      const allRegistrations = allRequests.map(r => ({
        id: r.id,
        customerName: r.customerName || "",
        contactName: r.contactName || "",
        region: r.region || "",
        location: r.location || "",
        status: r.status || "New Lead"
      }));

      // Map requests for technical services context description
      const allServices = allRequests.map(s => ({
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
${allCustomers.map((c: any) => ` * ID: ${c.id} | Name: "${c.name}" | Contact Person: "${c.contactName || ''}" | Phone: "${c.phone || ''}" | Region: "${c.region || ''}" | Vehicles count: ${c.vehicleCount || 0}`).join('\n')}

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

      const systemInstruction = `${currentPrompts.chat_assistant}

${dbContextStr}

CRITICAL FLUID CONVERSATION & INTELLIGENT MATCHING RULES:
1. ACT HUMAN & OPERATIONAL: Reply like a human sales or fleets officer in Dubai of Synosys Fleet Intelligence. Keep conversations natural, friendly, highly custom, and warm. Use phrases like "Oh, let me look that up!", "Great, Vishnu!", or "Welcome back."
2. DYNAMIC LOOKUP & MULTI-BRANCH CLARIFICATION:
   - When a user enters a customer or company name (such as "Clymate", "Clymet", "Inspirentals"), check the lists of active CRM Customers, Lead Registrations, and Services in the CURRENT CRM DATABASE RECORDS above.
   - If there are MULTIPLE similar/matching records in the database (e.g. searching for "Clymate" or "Clymet" matches Clymate Logistics, Clymate Technical Services, Clymate Transport, etc., or multiple branches of Inspirentals), STOP immediately. Do NOT register or default to a single choice, and do NOT output a SAVE block yet.
   - You MUST dynamically parse the active database context, list the ACTUAL matching records clearly with their details (database ID, customer name, region, and location if available), and ask the user to clarify which specific search result they mean, or if they are registering a brand-new entity entirely.
   - Example format you should use for listing live matches:
     "I searched our database and found a few active accounts matching 'Clymate'. Could you please clarify which of these accounts you are asking about, or if we should register a brand-new entity?
     - Clymate Logistics (ID: #1001, Region: Dubai, Location: DIP)
     - Clymate Logistics (ID: #1002, Region: Abu Dhabi, Location: KIZAD)
     - Clymate Technical Services (ID: #1003, Region: Abu Dhabi, Location: Musaffah)
     - Clymate Transport (ID: #1004, Region: Dubai, Location: Al Quoz)"
   - Always list the REAL matching records found in CURRENT CRM DATABASE RECORDS. Do not invent simulated entities if they are not in the context string.
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
5. TRIGGER SAVE FORMAT:
   When you do have sufficient details (such as customer name, contact phone, region, status: "New Lead", salesType: "New" or "Existing", and quantity), output your friendly reply followed by the TRIGGER BLOCK at the very end. The trigger block MUST use exactly this format:
   [[SAVE_RECORD:{"type":"registration","customerName":"...","contactName":"...","phone":"...","email":"...","region":"...","implementationType":"...","status":"New Lead","salesType":"Existing","requestedPerson":"...","comment":"...","qty":1}]]
   OR if it is a service ticket save:
   [[SAVE_RECORD:{"type":"service","customerName":"...","description":"...","assignee":"...","amount":"...","payment":"..."}]]
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
          console.error("Gemini API failed, falling back to Groq:", (geminiErr as Error).message);
        }
      }

      // 2. Try Groq (llama-3.1-8b-instant with specified API key) if Gemini failed or was unavailable
      if (!replyReceived) {
        try {
          console.log("[AI Chat] Gemini failed or unavailable, falling back to Groq API with llama-3.1-8b-instant...");
          const startTime = Date.now();
          
          // Build OpenAI-compatible messages payload
          const groqMessages = [
            { role: "system", content: systemInstruction }
          ];

          if (Array.isArray(history)) {
            for (const h of history) {
              const role = h.role === "assistant" || h.role === "model" ? "assistant" : "user";
              const content = h.content || (h.parts && h.parts[0]?.text) || "";
              if (content.trim()) {
                groqMessages.push({ role, content: content.trim() });
              }
            }
          }
          groqMessages.push({ role: "user", content: message });

          const groqKey = process.env.GROQ_API_KEY || "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";
          const groqResponse = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
              model: "llama-3.1-8b-instant",
              messages: groqMessages,
              temperature: 0.2
            },
            {
              headers: {
                "Authorization": `Bearer ${groqKey}`,
                "Content-Type": "application/json"
              },
              timeout: 30000
            }
          );

          if (groqResponse.status === 200 && groqResponse.data?.choices?.[0]?.message?.content) {
            reply = groqResponse.data.choices[0].message.content;
            console.log(`[AI Chat] Groq Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
            replyReceived = true;
          } else {
            throw new Error(`Groq returned status ${groqResponse.status}`);
          }
        } catch (groqErr) {
          console.error("Groq API failed, falling back to Ollama:", (groqErr as Error).message);
        }
      }

      // 3. Default to Ollama if both Gemini and Groq failed
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

      // Process records
      const savedResult = await handleAIRecordSave(reply);

      await db.insert(messages).values({ role: 'assistant', content: savedResult.reply });
      return res.json({ reply: savedResult.reply, savedRecord: savedResult.savedRecord });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get chat history
  app.get("/api/chat/history", async (req, res) => {
    try {
      const history = await db.select().from(messages).orderBy(messages.timestamp);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Log Ingestion & Parsing ---

  app.post("/api/ingest", async (req, res) => {
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
          console.error("Gemini API failed for log extraction, falling back to Groq:", (geminiErr as Error).message);
        }
      }

      // 2. Fall back to Groq if Gemini wasn't used or failed
      if (!parsedSuccessfully) {
        try {
          console.log("[AI Ingest] Falling back to Groq API block for log extraction with llama-3.1-8b-instant...");
          const startTime = Date.now();
          const groqKey = process.env.GROQ_API_KEY || "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";
          const groqResponse = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
              model: "llama-3.1-8b-instant",
              messages: [
                { role: "system", content: currentPrompts.log_extractor },
                { role: "user", content: "Extract records from these logs:\n" + batch }
              ],
              temperature: 0.1
            },
            {
              headers: {
                "Authorization": `Bearer ${groqKey}`,
                "Content-Type": "application/json"
              },
              timeout: 30000
            }
          );

          if (groqResponse.status === 200 && groqResponse.data?.choices?.[0]?.message?.content) {
            rawResponseContent = groqResponse.data.choices[0].message.content;
            console.log(`[AI Ingest] Groq Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
            parsedSuccessfully = true;
          } else {
            throw new Error(`Groq returned status ${groqResponse.status}`);
          }
        } catch (groqErr) {
          console.error("Groq API failed for log extraction, falling back to Ollama:", (groqErr as Error).message);
        }
      }

      // 3. Fall back to Ollama
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
  app.post("/api/ingest/save", async (req, res) => {
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
      server: { middlewareMode: true },
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

  app.listen(PORT, "0.0.0.0", async () => {
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

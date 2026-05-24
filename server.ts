import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { db, pool } from "./src/db";
import { customers, registrations, services, messages } from "./src/db/schema";
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
      CREATE TABLE IF NOT EXISTS registrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_name VARCHAR(255) NOT NULL,
        contact_name VARCHAR(255),
        designation VARCHAR(255),
        phone VARCHAR(50),
        email VARCHAR(255),
        region VARCHAR(100),
        address TEXT,
        map_link TEXT,
        coordinates VARCHAR(100),
        source VARCHAR(100),
        status VARCHAR(50) DEFAULT 'New Lead',
        implementation_type VARCHAR(100),
        sales_person VARCHAR(100),
        sales_type VARCHAR(100),
        requested_person VARCHAR(100),
        comment TEXT,
        project_value VARCHAR(100),
        price_details TEXT,
        accessories TEXT,
        new_qty INT DEFAULT 0,
        migrate_qty INT DEFAULT 0,
        trading_qty INT DEFAULT 0,
        service_qty INT DEFAULT 0,
        other_qty INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure all possible missing columns exist if table was created before they were added
    const columnsToCheck = [
      { name: 'designation', definition: 'VARCHAR(255) AFTER contact_name' },
      { name: 'address', definition: 'TEXT AFTER region' },
      { name: 'map_link', definition: 'TEXT AFTER address' },
      { name: 'coordinates', definition: 'VARCHAR(100) AFTER map_link' },
      { name: 'source', definition: 'VARCHAR(100) AFTER coordinates' },
      { name: 'sales_type', definition: 'VARCHAR(100) AFTER sales_person' },
      { name: 'requested_person', definition: 'VARCHAR(100) AFTER sales_type' },
      { name: 'comment', definition: 'TEXT AFTER requested_person' },
      { name: 'project_value', definition: 'VARCHAR(100) AFTER comment' },
      { name: 'price_details', definition: 'TEXT AFTER project_value' },
      { name: 'accessories', definition: 'TEXT AFTER price_details' },
      { name: 'new_qty', definition: 'INT DEFAULT 0 AFTER accessories' },
      { name: 'migrate_qty', definition: 'INT DEFAULT 0 AFTER new_qty' },
      { name: 'trading_qty', definition: 'INT DEFAULT 0 AFTER migrate_qty' },
      { name: 'service_qty', definition: 'INT DEFAULT 0 AFTER trading_qty' },
      { name: 'other_qty', definition: 'INT DEFAULT 0 AFTER service_qty' }
    ];

    for (const col of columnsToCheck) {
      try {
        const [exists]: any = await pool.execute(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'registrations' 
          AND COLUMN_NAME = '${col.name}'
        `);
        if (exists.length === 0) {
          console.log(`Adding missing column '${col.name}' to 'registrations' table...`);
          await pool.execute(`ALTER TABLE registrations ADD COLUMN ${col.name} ${col.definition}`);
        }
      } catch (colErr: any) {
        // If it failed because of duplicate column (code 1060), we can safe-ignore
        if (colErr.code === 'ER_DUP_FIELDNAME' || colErr.errno === 1060) {
          console.log(`Column '${col.name}' already exists.`);
        } else {
          console.warn(`Failed to check/add '${col.name}' column:`, colErr.message);
          // Fallback direct execution just in case
          try {
            await pool.execute(`ALTER TABLE registrations ADD COLUMN ${col.name} ${col.definition}`);
          } catch (innerErr: any) {
            if (innerErr.code !== 'ER_DUP_FIELDNAME' && innerErr.errno !== 1060) {
              console.warn(`Direct ALTER fallback also failed for '${col.name}':`, innerErr.message);
            }
          }
        }
      }
    }

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS services (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id VARCHAR(50) NOT NULL UNIQUE,
        customer_name VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'New',
        quantity INT DEFAULT 1,
        requested_person VARCHAR(100),
        payment VARCHAR(50),
        invoice_status VARCHAR(50) DEFAULT 'Not Invoiced',
        payment_status VARCHAR(50) DEFAULT 'Not Paid',
        amount VARCHAR(50),
        assignee VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure all possible missing columns exist if services table was created before they were added
    const serviceColumnsToCheck = [
      { name: 'quantity', definition: 'INT DEFAULT 1 AFTER status' },
      { name: 'requested_person', definition: 'VARCHAR(100) AFTER quantity' },
      { name: 'payment', definition: 'VARCHAR(50) AFTER requested_person' },
      { name: 'invoice_status', definition: 'VARCHAR(50) DEFAULT \'Not Invoiced\' AFTER payment' },
      { name: 'payment_status', definition: 'VARCHAR(50) DEFAULT \'Not Paid\' AFTER invoice_status' },
      { name: 'amount', definition: 'VARCHAR(50) AFTER payment_status' },
      { name: 'assignee', definition: 'VARCHAR(100) AFTER amount' }
    ];

    for (const col of serviceColumnsToCheck) {
      try {
        const [exists]: any = await pool.execute(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'services' 
          AND COLUMN_NAME = '${col.name}'
        `);
        if (exists.length === 0) {
          console.log(`Adding missing column '${col.name}' to 'services' table...`);
          await pool.execute(`ALTER TABLE services ADD COLUMN ${col.name} ${col.definition}`);
        }
      } catch (colErr: any) {
        if (colErr.code === 'ER_DUP_FIELDNAME' || colErr.errno === 1060) {
          console.log(`Column '${col.name}' already exists in services table.`);
        } else {
          console.warn(`Failed to check/add '${col.name}' column to services table:`, colErr.message);
          try {
            await pool.execute(`ALTER TABLE services ADD COLUMN ${col.name} ${col.definition}`);
          } catch (innerErr: any) {
            if (innerErr.code !== 'ER_DUP_FIELDNAME' && innerErr.errno !== 1060) {
              console.warn(`Direct ALTER fallback also failed for services '${col.name}':`, innerErr.message);
            }
          }
        }
      }
    }

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

    console.log(`Found CSV dataset at ${path.basename(csvPath)}. Truncating tables and seeding entire custom dataset...`);
    try {
      await pool.execute("TRUNCATE TABLE customers");
      await pool.execute("TRUNCATE TABLE registrations");
      await pool.execute("TRUNCATE TABLE services");
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
      console.log(`Seeding ${registrationValues.length} registrations...`);
      for (let i = 0; i < registrationValues.length; i += 50) {
        const chunk = registrationValues.slice(i, i + 50);
        await db.insert(registrations).values(chunk);
      }
    }

    if (serviceValues.length > 0) {
      console.log(`Seeding ${serviceValues.length} services...`);
      for (let i = 0; i < serviceValues.length; i += 50) {
        const chunk = serviceValues.slice(i, i + 50);
        await db.insert(services).values(chunk);
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
        await db.delete(registrations).where(eq(registrations.id, id));
        return {
          reply: reply.replace(deleteMatch[0], "").trim() + `\n\n(CRM: Registration record #${id} deleted successfully.)`
        };
      } else if (record.type === "service") {
        await db.delete(services).where(eq(services.id, id));
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
      console.log(`[AI Auto-Update] Detected record: ${record.type}, ID: ${id}`);
      if (record.type === "registration") {
        await db.update(registrations).set(record.data).where(eq(registrations.id, id));
        return {
          reply: reply.replace(updateMatch[0], "").trim() + `\n\n(CRM: Registration #${id} updated successfully.)`
        };
      } else if (record.type === "service") {
        await db.update(services).set(record.data).where(eq(services.id, id));
        return {
          reply: reply.replace(updateMatch[0], "").trim() + `\n\n(CRM: Service ticket #${id} updated successfully.)`
        };
      } else if (record.type === "customer") {
        await db.update(customers).set(record.data).where(eq(customers.id, id));
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
      const [res]: any = await db.insert(registrations).values({
        customerName: record.customerName || "Unknown",
        contactName: record.contactName || "",
        designation: record.designation || "",
        phone: record.phone || "",
        email: record.email || "",
        region: record.region || "",
        address: record.address || "",
        mapLink: record.mapLink || "",
        coordinates: record.coordinates || "",
        source: record.source || "",
        status: record.status || "New Lead",
        implementationType: record.implementationType || "",
        salesPerson: record.salesPerson || "",
        salesType: record.salesType || "",
        requestedPerson: record.requestedPerson || "",
        comment: record.comment || "",
        projectValue: record.projectValue || "",
        priceDetails: record.priceDetails || "",
        accessories: record.accessories || "",
        newQty: record.qty || record.newQty || 0,
        migrateQty: record.migrateQty || 0,
        tradingQty: record.tradingQty || 0,
        serviceQty: record.serviceQty || 0,
        otherQty: record.otherQty || 0
      });

      // Synchronize registration customer to customers table
      try {
        const customerName = record.customerName || "Unknown";
        if (customerName && customerName !== "Unknown") {
          const existing = await db.select().from(customers).where(eq(customers.name, customerName));
          const totalQty = parseInt(record.qty || record.newQty || 1);
          if (existing.length === 0) {
            await db.insert(customers).values({
              name: customerName,
              contactName: record.contactName || "",
              phone: record.phone || "",
              email: record.email || "",
              region: record.region || "",
              implementationType: record.implementationType || "",
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
      const [res]: any = await db.insert(services).values({
        ticketId,
        customerName: record.customerName || "Unknown",
        description: record.description || "",
        status: record.status || "New",
        quantity: record.quantity || 1,
        requestedPerson: record.requestedPerson || "",
        payment: record.payment || "",
        invoiceStatus: record.invoiceStatus || "Not Invoiced",
        paymentStatus: record.paymentStatus || "Not Paid",
        amount: record.amount || "",
        assignee: record.assignee || ""
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
      const allRegistrations = await db.select().from(registrations);
      const allServices = await db.select().from(services);
      res.json({ registrations: allRegistrations, services: allServices, customers: allCustomers });
    } catch (error) {
      console.error("Dashboard data fetch failed:", error);
      res.status(500).json({ 
        error: (error as Error).message,
        details: "Check database connection and table existence. Ensure initDB completed successfully." 
      });
    }
  });

  // Create new registration
  app.post("/api/leads/new", async (req, res) => {
    try {
      const body = req.body;
      const [result] = await db.insert(registrations).values({
        customerName: body.customerName || body.customer_name,
        contactName: body.contactName || body.contact_name,
        designation: body.designation,
        phone: body.phone,
        email: body.email,
        region: body.region,
        address: body.address,
        mapLink: body.mapLink || body.map_link,
        coordinates: body.coordinates,
        source: body.source,
        status: body.status || 'New Lead',
        implementationType: body.implementationType || body.implementation_type,
        salesPerson: body.salesPerson || body.sales_person,
        salesType: body.salesType || body.sales_type,
        requestedPerson: body.requestedPerson || body.requested_person,
        comment: body.comment,
        projectValue: body.projectValue || body.project_value,
        priceDetails: body.priceDetails || body.price_details,
        accessories: body.accessories,
        newQty: parseInt(body.newQty || body.new_qty || 0),
        migrateQty: parseInt(body.migrateQty || body.migrate_qty || 0),
        tradingQty: parseInt(body.tradingQty || body.trading_qty || 0),
        serviceQty: parseInt(body.serviceQty || body.service_qty || 0),
        otherQty: parseInt(body.otherQty || body.other_qty || 0),
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
      const ticketId = body.ticketId || body.ticket_id || ('TKT-' + crypto.randomBytes(4).toString('hex').toUpperCase());
      const [result] = await db.insert(services).values({
        ticketId,
        customerName: body.customerName || body.customer_name,
        description: body.description,
        status: body.status || 'New',
        quantity: parseInt(body.quantity || 1),
        requestedPerson: body.requestedPerson || body.requested_person,
        payment: body.payment,
        invoiceStatus: body.invoiceStatus || body.invoice_status || 'Not Invoiced',
        paymentStatus: body.paymentStatus || body.payment_status || 'Not Paid',
        amount: body.amount,
        assignee: body.assignee,
      });
      res.json({ success: true, id: result.insertId, ticket_id: ticketId, message: 'Service ticket created' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Edit/Update lead registration
  app.put("/api/leads/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const b = req.body;
      await db.update(registrations).set({
        customerName: b.customerName,
        contactName: b.contactName,
        designation: b.designation,
        phone: b.phone,
        email: b.email,
        region: b.region,
        address: b.address,
        mapLink: b.mapLink,
        coordinates: b.coordinates,
        source: b.source,
        status: b.status,
        implementationType: b.implementationType,
        salesPerson: b.salesPerson,
        salesType: b.salesType,
        requestedPerson: b.requestedPerson,
        comment: b.comment,
        projectValue: b.projectValue,
        priceDetails: b.priceDetails,
        accessories: b.accessories,
        newQty: parseInt(b.newQty || 0),
        migrateQty: parseInt(b.migrateQty || 0),
        tradingQty: parseInt(b.tradingQty || 0),
        serviceQty: parseInt(b.serviceQty || 0),
        otherQty: parseInt(b.otherQty || 0)
      }).where(eq(registrations.id, parseInt(id)));
      res.json({ success: true, message: "Lead registration updated successfully" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Delete lead registration
  app.delete("/api/leads/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(registrations).where(eq(registrations.id, parseInt(id)));
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
      await db.update(services).set({
        customerName: b.customerName,
        description: b.description,
        status: b.status,
        quantity: parseInt(b.quantity || 1),
        requestedPerson: b.requestedPerson,
        payment: b.payment,
        invoiceStatus: b.invoiceStatus,
        paymentStatus: b.paymentStatus,
        amount: b.amount,
        assignee: b.assignee
      }).where(eq(services.id, parseInt(id)));
      res.json({ success: true, message: "Service ticket updated successfully" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Delete service task
  app.delete("/api/services/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(services).where(eq(services.id, parseInt(id)));
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
      const allRegistrations = await db.select().from(registrations);
      const allServices = await db.select().from(services);

      const dbContextStr = `
CURRENT CRM DATABASE RECORDS:
 --- Customers ---
${allCustomers.map((c: any) => ` * ID: ${c.id} | Name: "${c.name}" | Contact Person: "${c.contactName || ''}" | Phone: "${c.phone || ''}" | Region: "${c.region || ''}" | Vehicles count: ${c.vehicleCount || 0}`).join('\n')}

--- Lead Registrations ---
${allRegistrations.map((r: any) => ` * ID: ${r.id} | Customer: "${r.customerName}" | Contact Person: "${r.contactName || ''}" | Region: "${r.region || ''}" | Status: "${r.status || 'New Lead'}"`).join('\n')}

--- Active Service Queue ---
${allServices.map((s: any) => ` * ID: ${s.id} | Customer: "${s.customerName}" | Description: "${s.description || ''}" | Status: "${s.status || 'Ongoing'}" | Assignee: "${s.assignee || 'Unassigned'}" | Amount: "${s.amount || ''}"`).join('\n')}
`;

      const systemInstruction = `${prompts.chat_assistant}

${dbContextStr}

CRITICAL FLUID CONVERSATION & INTELLIGENT MATCHING RULES:
1. ACT HUMAN & OPERATIONAL: Reply like a human sales or fleets officer in Dubai of Synosys Fleet Intelligence. Keep conversations natural, friendly, highly custom, and warm. Use phrases like "Oh, let me look that up!", "Great, Vishnu!", or "Welcome back."
2. DATABASE LOOKUP & MULTI-BRANCH CLARIFICATION:
   - When a user enters a customer name (e.g. "Clymet", "Inspirentals"), check the lists of active CRM Customers and Lead Registrations above.
   - If there are MULTIPLE similar/matching accounts (e.g. "Clymet Logistics", "Clymet Abu Dhabi", "Clymet Sharjah Co" etc.), stop. DO NOT log any record yet. Output a highly conversational response listing the matches and ask: "I searched our CRM database and found a few accounts for 'Clymet':
     1. Clymet Logistics (region: DIP / kizad)
     2. Clymet Abu Dhabi (region: Abu Dhabi)
     3. Clymet Sharjah Co (region: Sharjah)
     Could you please clarify which of these accounts you are asking about, or if we should register a brand-new entity?"
   - Similarly for "Inspirentals", we have:
     1. INSPIRENTALS MIDDLE EAST REAL ESTATE LEASE AND MANAGEMENT SERVICES LLC (Abu Dhabi)
     2. Inspirentals Dubai Branch (Dubai)
     Clarify which branch they mean!
3. CONVERSATIONAL FILLING ("DON'T BE ROBOTIC"):
   - Real humans don't paste perfect structures. They type in fragments (e.g. "Create a service ticket for Clymet" or "Register Ms. Aan").
   - If they ask to save/create/register something but leave out important details (like quantity, contact phone number, implementation type, or location region), DO NOT output a trigger save block yet unless they say "save what you have".
   - Instead, reply instantly with human warmth and ask for the missing details step-by-step: "Absolutely, I can help you file that lead. I saw that they are [Customer Name]. What is the correct quantity of devices or location region for this lead?"
4. TRIGGER SAVE FORMAT:
   When you do have sufficient details (such as customer name, contact phone, region, status: "New Lead", salesType: "New" or "Existing", and quantity), output your friendly reply followed by the TRIGGER BLOCK at the very end. The trigger block MUST use exactly this format:
   [[SAVE_RECORD:{"type":"registration","customerName":"...","contactName":"...","phone":"...","email":"...","region":"...","implementationType":"...","status":"New Lead","salesType":"Existing","requestedPerson":"...","comment":"...","qty":1}]]
   OR if it is a service:
   [[SAVE_RECORD:{"type":"service","customerName":"...","description":"...","assignee":"...","amount":"...","payment":"..."}]]
`;

      // Prefer Gemini if available
      if (genAI) {
        try {
          console.log("[AI Chat] Using Gemini 3.5 API with rich live DB context...");
          const chat = genAI.chats.create({
            model: "gemini-3.5-flash",
            history: history.map((h: any) => ({
              role: h.role === "assistant" ? "model" : "user",
              parts: [{ text: h.content }],
            })),
            config: {
              systemInstruction: systemInstruction,
            },
          });

          const startTime = Date.now();
          const result = await chat.sendMessage({ message: message });
          let reply = result.text;
          
          console.log(`[AI Chat] Gemini Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
          
          // Process records
          const savedResult = await handleAIRecordSave(reply);

          await db.insert(messages).values({ role: 'assistant', content: savedResult.reply });
          return res.json({ reply: savedResult.reply, savedRecord: savedResult.savedRecord });
        } catch (geminiErr) {
          console.error("Gemini API failed, falling back to Ollama:", (geminiErr as Error).message);
        }
      }

      // Default to Ollama with the exact same rich DB Context prompt
      let ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
      if (!ollamaUrl.endsWith("/api/chat")) {
        ollamaUrl = ollamaUrl.replace(/\/$/, "") + "/api/chat";
      }
      
      try {
        const ollamaOptions: any = {
          num_ctx: parseInt(process.env.OLLAMA_NUM_CTX || "2048"),
          num_thread: parseInt(process.env.OLLAMA_NUM_THREAD || "4"),
        };

        const gpuConfig = parseInt(process.env.OLLAMA_NUM_GPU || "-1");
        ollamaOptions.num_gpu = gpuConfig;
        
        if (gpuConfig !== -1) {
          ollamaOptions.main_gpu = 0;
        }

        const requestBody = {
          model: process.env.OLLAMA_MODEL || "llama3:latest",
          messages: [
            { role: "system", content: systemInstruction },
            ...history,
            { role: "user", content: message }
          ],
          options: ollamaOptions,
          keep_alive: process.env.OLLAMA_KEEP_ALIVE || "5m",
          stream: false
        };

        console.log(`[AI Chat] START Ollama: model=${requestBody.model}, options=${JSON.stringify(ollamaOptions)}`);
        
        const startTime = Date.now();
        const response = await axios.post(ollamaUrl, requestBody, { 
          timeout: 300000,
          validateStatus: () => true 
        });

        if (response.status !== 200) {
          throw new Error(`Ollama returned status ${response.status}`);
        }

        console.log(`[AI Chat] Ollama Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        let reply = response.data.message.content;
        
        // Process records
        const savedResult = await handleAIRecordSave(reply);

        // Save assistant message
        await db.insert(messages).values({ role: 'assistant', content: savedResult.reply });
        
        res.json({ reply: savedResult.reply, savedRecord: savedResult.savedRecord });
      } catch (ollamaErr) {
        console.error("Ollama connection failed:", (ollamaErr as Error).message);
        // Final fallback
        const fallback = "I'm the SynoHub AI Assistant. I detected a temporary delay in my local processor. How can I help you manage your fleet today?";
        await db.insert(messages).values({ role: 'assistant', content: fallback });
        res.json({ reply: fallback, error: "AI Engine not reachable. Using fallback response." });
      }
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
      
      let ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
      if (!ollamaUrl.endsWith("/api/chat")) {
        ollamaUrl = ollamaUrl.replace(/\/$/, "") + "/api/chat";
      }

      const batch = messages_raw.slice(0, 10).join("\n---\n"); // Process first 10 for demo speed

      const ollamaOptions: any = {
        num_ctx: parseInt(process.env.OLLAMA_NUM_CTX || "2048"),
        num_thread: parseInt(process.env.OLLAMA_NUM_THREAD || "4"),
      };

      // Only add GPU if explicitly set, default to -1 (auto)
      const gpuConfig = parseInt(process.env.OLLAMA_NUM_GPU || "-1");
      ollamaOptions.num_gpu = gpuConfig;
      
      if (gpuConfig !== -1) {
        ollamaOptions.main_gpu = 0;
      }

      console.log(`[AI Ingest] START: model=${process.env.OLLAMA_MODEL || "llama3:latest"}, options=${JSON.stringify(ollamaOptions)}`);
      console.log(`[AI Ingest] URL: ${ollamaUrl}`);
      const startTime = Date.now();

      const response = await axios.post(ollamaUrl, {
        model: process.env.OLLAMA_MODEL || "llama3:latest",
        messages: [
          { role: "system", content: prompts.log_extractor },
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

      let content = response.data.message.content;
      // Cleanup common LLM markdown noise
      content = content.replace(/```json|```/g, "").trim();
      
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
          await db.insert(registrations).values({
            customerName: rec.customerName,
            contactName: rec.contactName,
            designation: rec.designation,
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
          const ticketId = rec.ticketId || ('TKT-' + crypto.randomBytes(4).toString('hex').toUpperCase());
          await db.insert(services).values({
            ticketId,
            customerName: rec.customerName,
            description: rec.description,
            status: rec.status || 'New',
            quantity: rec.quantity || 1,
            requestedPerson: rec.requestedPerson,
            payment: rec.payment,
            invoiceStatus: rec.invoiceStatus || 'Not Invoiced',
            paymentStatus: rec.paymentStatus || 'Not Paid',
            amount: rec.amount,
            assignee: rec.assignee
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

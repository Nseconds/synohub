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
    const hasClymet = await db.select().from(customers).where(eq(customers.name, 'Clymet Logistics')).limit(1);
    if (hasClymet.length > 0) {
      console.log("Database already has rich entries.");
      return;
    }

    console.log("Seeding rich initial data with multiple test branches and matches...");
    
    try {
      await pool.execute("TRUNCATE TABLE customers");
      await pool.execute("TRUNCATE TABLE registrations");
      await pool.execute("TRUNCATE TABLE services");
    } catch (truncateErr) {
      console.log("Truncate ignored, executing direct insert");
    }
    
    await db.insert(customers).values([
      { name: 'Al Noor Transport', contactName: 'Ahmed Ali', phone: '+971501112222', email: 'ahmed@alnoor.ae', region: 'Dubai', implementationType: 'LOCATOR', vehicleCount: 24 },
      { name: 'Gulf Cargo LLC', contactName: 'Saeed Mansoor', phone: '+971502223333', email: 'saeed@gulfcargo.ae', region: 'Abu Dhabi', implementationType: 'LOCATOR+ASATEEL', vehicleCount: 18 },
      { name: 'Emirates Freight', contactName: 'Mohammed Hassan', phone: '+971503334444', email: 'mohammed@emiratesfreight.ae', region: 'Sharjah', implementationType: 'SECUREPATH', vehicleCount: 35 },
      
      // Seeding similar named clients for the chatbot lookup/clarification feature
      { name: 'Clymet Logistics', contactName: 'Vishnu', phone: '+971501445390', email: 'vishnu@clymet.com', region: 'DIP / kizad', implementationType: 'Locator + Securepath', vehicleCount: 12 },
      { name: 'Clymet Abu Dhabi', contactName: 'Vishnu', phone: '+971501445390', email: 'vishnu.ad@clymet.com', region: 'Abu Dhabi', implementationType: 'LOCATOR', vehicleCount: 8 },
      { name: 'Clymet Sharjah Co', contactName: 'Fajr', phone: '+971505553331', email: 'fajr@clymet.com', region: 'Sharjah', implementationType: 'SECUREPATH', vehicleCount: 15 },
      
      // Seeding INSPIRENTALS branches
      { name: 'INSPIRENTALS MIDDLE EAST REAL ESTATE LEASE AND MANAGEMENT SERVICES LLC', contactName: 'Ms. Aan', phone: '+971505987534', email: 'aan@inspirentals.ae', region: 'Abu Dhabi', implementationType: 'LOCATOR', vehicleCount: 9 },
      { name: 'Inspirentals Dubai Branch', contactName: 'Ms. Aan', phone: '+971505987534', email: 'dubai@inspirentals.ae', region: 'Dubai', implementationType: 'LOCATOR', vehicleCount: 4 },
    ]);

    await db.insert(registrations).values([
      { customerName: 'Khalid Logistics', contactName: 'Khalid', region: 'Dubai', status: 'New Lead', salesPerson: 'Nishad', newQty: 10 },
      { customerName: 'RAK Trading', contactName: 'Sultan', region: 'Ras Al Khaimah', status: 'Won', salesPerson: 'Vishal', newQty: 5 },
      { customerName: 'Clymet Logistics', contactName: 'Vishnu', region: 'DIP / kizad', status: 'New Lead', salesPerson: 'Nishad', newQty: 2, comment: '1 device removal (24843 Test Temp on Trailer) and 1 BLE Temp sensor' },
      { customerName: 'INSPIRENTALS MIDDLE EAST REAL ESTATE LEASE AND MANAGEMENT SERVICES LLC', contactName: 'Ms. Aan', region: 'Abu Dhabi', status: 'New Lead', salesPerson: 'Nishad', newQty: 1, comment: 'MG 50974 GPS Device + Temp Sensor' }
    ]);

    await db.insert(services).values([
      { ticketId: 'TKT-A1B2C3', customerName: 'Al Noor Transport', description: 'GPS device not updating location in Asateel', status: 'Ongoing', assignee: 'Athul', amount: '150' },
      { ticketId: 'TKT-C7D8E9', customerName: 'Clymet Logistics', description: 'BLE Temperature integration setup', status: 'Delivered', assignee: 'Feros', amount: '350', payment: 'Cash' }
    ]);

    console.log("Seeding complete with rich test data.");
  } catch (e) {
    console.error("Seeding failed (DB might not be ready):", (e as Error).message);
  }
}

// Helper to handle AI record saving via trigger tags
async function handleAIRecordSave(reply: string): Promise<{ reply: string; savedRecord?: any }> {
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
      await db.insert(services).values({
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
        savedRecord: record
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
${allCustomers.map(c => ` * ID: ${c.id} | Name: "${c.name}" | Contact Person: "${c.contactName || ''}" | Phone: "${c.phone || ''}" | Region: "${c.region || ''}" | Vehicles count: ${c.vehicleCount || 0}`).join('\n')}

--- Lead Registrations ---
${allRegistrations.map(r => ` * ID: ${r.id} | Customer: "${r.customerName}" | Contact Person: "${r.contactName || ''}" | Region: "${r.region || ''}" | Status: "${r.status || 'New Lead'}"`).join('\n')}

--- Active Service Queue ---
${allServices.map(s => ` * ID: ${s.id} | Customer: "${s.customerName}" | Description: "${s.description || ''}" | Status: "${s.status || 'Ongoing'}" | Assignee: "${s.assignee || 'Unassigned'}" | Amount: "${s.amount || ''}"`).join('\n')}
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

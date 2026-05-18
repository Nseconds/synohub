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

console.log("--- Environment Variable Sync Check ---");
console.log("OLLAMA_URL:", process.env.OLLAMA_URL);
console.log("OLLAMA_MODEL:", process.env.OLLAMA_MODEL);
console.log("OLLAMA_NUM_THREAD:", process.env.OLLAMA_NUM_THREAD);
console.log("OLLAMA_NUM_GPU:", process.env.OLLAMA_NUM_GPU);
console.log("---------------------------------------");

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

    if (process.env.DB_SOCKET && process.env.DB_SOCKET.trim() !== '') {
      initConfig.socketPath = process.env.DB_SOCKET;
      console.log('INIT DB: Using socket:', initConfig.socketPath);
    } else {
      initConfig.host = process.env.DB_HOST || '127.0.0.1';
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
        phone VARCHAR(50),
        email VARCHAR(255),
        region VARCHAR(100),
        implementation_type VARCHAR(100),
        status VARCHAR(50) DEFAULT 'New Lead',
        sales_person VARCHAR(100),
        sales_type VARCHAR(50),
        new_qty INT DEFAULT 0,
        migrate_qty INT DEFAULT 0,
        trading_qty INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS services (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ticket_id VARCHAR(50) NOT NULL UNIQUE,
        customer_name VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'New',
        assignee VARCHAR(100),
        payment VARCHAR(50),
        amount VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    const existingCustomers = await db.select().from(customers).limit(1);
    if (existingCustomers.length > 0) return;

    console.log("Seeding initial data...");
    
    await db.insert(customers).values([
      { name: 'Al Noor Transport', contactName: 'Ahmed Ali', phone: '+971501112222', email: 'ahmed@alnoor.ae', region: 'Dubai', implementationType: 'LOCATOR', vehicleCount: 24 },
      { name: 'Gulf Cargo LLC', contactName: 'Saeed Mansoor', phone: '+971502223333', email: 'saeed@gulfcargo.ae', region: 'Abu Dhabi', implementationType: 'LOCATOR+ASATEEL', vehicleCount: 18 },
      { name: 'Emirates Freight', contactName: 'Mohammed Hassan', phone: '+971503334444', email: 'mohammed@emiratesfreight.ae', region: 'Sharjah', implementationType: 'SECUREPATH', vehicleCount: 35 },
    ]);

    await db.insert(registrations).values([
      { customerName: 'Khalid Logistics', contactName: 'Khalid', region: 'Dubai', status: 'New Lead', salesPerson: 'Nishad', newQty: 10 },
      { customerName: 'RAK Trading', contactName: 'Sultan', region: 'Ras Al Khaimah', status: 'Won', salesPerson: 'Vishal', newQty: 5 },
    ]);

    await db.insert(services).values([
      { ticketId: 'TKT-A1B2C3', customerName: 'Al Noor Transport', description: 'GPS device not updating location in Asateel', status: 'Ongoing', assignee: 'Athul', amount: '150' },
    ]);

    console.log("Seeding complete.");
  } catch (e) {
    console.error("Seeding failed (DB might not be ready):", (e as Error).message);
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
        customerName: body.customer_name,
        contactName: body.contact_name,
        phone: body.phone,
        email: body.email,
        region: body.region,
        implementationType: body.implementation_type,
        status: body.status || 'New Lead',
        salesPerson: body.sales_person,
        salesType: body.sales_type || 'New',
        newQty: body.new_qty || 0,
      });
      res.json({ success: true, id: result.insertId, message: 'Registration created' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Create service request
  app.post("/api/services", async (req, res) => {
    try {
      const body = req.body;
      const ticketId = 'TKT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      const [result] = await db.insert(services).values({
        ticketId,
        customerName: body.customer_name,
        description: body.description,
        status: body.status || 'New',
        assignee: body.assignee,
        payment: body.payment,
        amount: body.amount,
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

  // Chat/Ollama endpoint
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history } = req.body;
      
      // Save user message
      await db.insert(messages).values({ role: 'user', content: message });

      let ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
      if (!ollamaUrl.endsWith("/api/chat")) {
        ollamaUrl = ollamaUrl.replace(/\/$/, "") + "/api/chat";
      }
      
      try {
        const ollamaOptions: any = {
          num_ctx: parseInt(process.env.OLLAMA_NUM_CTX || "2048"),
          num_thread: parseInt(process.env.OLLAMA_NUM_THREAD || "4"),
        };

        // Only add GPU if explicitly set to non-auto (-1)
        const gpuConfig = parseInt(process.env.OLLAMA_NUM_GPU || "-1");
        if (gpuConfig !== -1) {
          ollamaOptions.num_gpu = gpuConfig;
        }

        const requestBody = {
          model: process.env.OLLAMA_MODEL || "llama3:latest",
          messages: [
            { role: "system", content: prompts.chat_assistant },
            ...history,
            { role: "user", content: message }
          ],
          options: ollamaOptions,
          keep_alive: process.env.OLLAMA_KEEP_ALIVE || "5m",
          stream: false
        };

        console.log(`[AI Chat] START: model=${requestBody.model}, options=${JSON.stringify(ollamaOptions)}`);
        console.log(`[AI Chat] URL: ${ollamaUrl}`);
        
        const startTime = Date.now();
        const response = await axios.post(ollamaUrl, requestBody, { 
          timeout: 300000,
          validateStatus: () => true // Log even 500s
        });

        if (response.status !== 200) {
          throw new Error(`Ollama returned status ${response.status}: ${JSON.stringify(response.data)}`);
        }

        console.log(`[AI Chat] Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        const reply = response.data.message.content;
        
        // Save assistant message
        await db.insert(messages).values({ role: 'assistant', content: reply });
        
        res.json({ reply });
      } catch (ollamaErr) {
        console.error("Ollama connection failed:", (ollamaErr as Error).message);
        // Fallback for demo when local server is not actually there
        const fallback = "I'm the SynoHub AI Assistant. I detected an Ollama connection issue, but here's a generic response: How can I help you manage your fleet today?";
        await db.insert(messages).values({ role: 'assistant', content: fallback });
        res.json({ reply: fallback, error: "Ollama not reachable. Using fallback response." });
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

      // Only add GPU if explicitly set to non-auto (-1)
      const gpuConfig = parseInt(process.env.OLLAMA_NUM_GPU || "-1");
      if (gpuConfig !== -1) {
        ollamaOptions.num_gpu = gpuConfig;
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
            phone: rec.phone,
            email: rec.email,
            region: rec.region,
            implementationType: rec.implementationType,
            status: rec.status,
            newQty: rec.qty || 0
          });
        } else if (rec.type === "service") {
          const ticketId = 'TKT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
          await db.insert(services).values({
            ticketId,
            customerName: rec.customerName,
            description: rec.description,
            status: 'New',
            assignee: rec.assignee,
            payment: rec.payment,
            amount: rec.amount
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

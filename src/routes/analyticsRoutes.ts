import axios from "axios";
import type { Express } from "express";
import { requireAuth, requireRoles } from "../auth/middleware";
import { db } from "../db";
import { serviceRequests } from "../db/schema";
import env from "../shared/validation/env";
import {
  cleanedGeminiKey,
  cleanedOpenRouterKey,
  geminiModel,
  genAI,
  openRouterModel,
  openRouterPrimaryLabel,
  runOpenRouterChatCompletion,
} from "../ai/providerConfig";
import { loadPrompts } from "../ai/prompts/promptLoader";

const prompts = loadPrompts();

export function registerAnalyticsRoutes(app: Express) {
  app.post("/api/ingest", requireAuth, requireRoles("admin", "staff"), async (req, res) => {
    try {
      const { rawLog } = req.body;
      if (!rawLog) return res.status(400).json({ error: "Missing raw log" });

      const messages_raw = rawLog.split(/\n(?=\d{2}\/\d{2}\/\d{4},)/g);
      const batch = messages_raw.slice(0, 10).join("\n---\n");

      let currentPrompts = { ...prompts };
      try {
        currentPrompts = loadPrompts();
      } catch (err) {
        console.error("Failed to load prompts dynamically in /api/ingest:", err);
      }

      let parsedSuccessfully = false;
      let rawResponseContent = "";

      if (genAI && cleanedGeminiKey) {
        try {
          console.log(`[AI Ingest] Using Gemini API with log extractor prompt: model=${geminiModel}`);
          const startTime = Date.now();
          const response = await genAI.models.generateContent({
            model: geminiModel,
            contents: "Extract records from these logs:\n" + batch,
            config: {
              systemInstruction: currentPrompts.log_extractor,
              responseMimeType: "application/json",
            },
          });
          console.log(`[AI Ingest] Gemini Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
          rawResponseContent = response.text;
          parsedSuccessfully = true;
        } catch (geminiErr) {
          console.error("Gemini failed for log extraction, falling back to Ollama:", (geminiErr as Error).message);
        }
      }

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

      if (!parsedSuccessfully) {
        let ollamaUrl = env.OLLAMA_URL;
        if (!ollamaUrl.endsWith("/api/chat")) {
          ollamaUrl = ollamaUrl.replace(/\/$/, "") + "/api/chat";
        }

        const ollamaOptions: any = {
          num_ctx: parseInt(env.OLLAMA_NUM_CTX, 10),
          num_thread: parseInt(env.OLLAMA_NUM_THREAD, 10),
        };

        const gpuConfig = parseInt(env.OLLAMA_NUM_GPU, 10);
        ollamaOptions.num_gpu = gpuConfig;

        if (gpuConfig !== -1) {
          ollamaOptions.main_gpu = 0;
        }

        const currentOllamaModel = env.OLLAMA_MODEL;

        console.log(`[AI Ingest] START: model=${currentOllamaModel}, options=${JSON.stringify(ollamaOptions)}`);
        console.log(`[AI Ingest] URL: ${ollamaUrl}`);
        const startTime = Date.now();

        const response = await axios.post(ollamaUrl, {
          model: currentOllamaModel,
          messages: [
            { role: "system", content: currentPrompts.log_extractor },
            { role: "user", content: "Extract records from these logs:\n" + batch },
          ],
          options: ollamaOptions,
          keep_alive: env.OLLAMA_KEEP_ALIVE,
          stream: false,
        }, {
          timeout: 300000,
          validateStatus: () => true,
        });

        if (response.status !== 200) {
          throw new Error(`Ollama returned status ${response.status}: ${JSON.stringify(response.data)}`);
        }

        console.log(`[AI Ingest] Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        rawResponseContent = response.data.message.content;
        parsedSuccessfully = true;
      }

      const content = rawResponseContent.replace(/```json|```/g, "").trim();
      const extracted = JSON.parse(content);
      res.json({ extracted });
    } catch (error) {
      console.error("Ingestion failed:", (error as Error).message);
      res.status(500).json({ error: "AI Parsing failed. Check Ollama connection.", details: (error as Error).message });
    }
  });

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
            status: rec.status || "New Lead",
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
            otherQty: rec.otherQty || 0,
          });
        } else if (rec.type === "service") {
          await db.insert(serviceRequests).values({
            customerName: rec.customerName,
            issueDescription: rec.description,
            jobStatus: rec.status || "Pending",
            newQty: rec.quantity || 1,
            requestedPerson: rec.requestedPerson,
            paymentStatus: rec.payment,
            amount: rec.amount,
            salesPerson: rec.assignee,
          });
        }
      }
      res.json({ success: true, message: "Bulk import complete" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });
}

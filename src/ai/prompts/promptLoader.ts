import fs from "fs";
import path from "path";

export interface SynoHubPrompts {
  chat_assistant: string;
  log_extractor: string;
  [key: string]: string;
}

export const defaultPrompts: SynoHubPrompts = {
  chat_assistant: "You are a SynoHub Assistant for Synosys, a fleet management SaaS company in the UAE. Assist users with CRM queries, service tickets, and registrations.",
  log_extractor: "You are a professional data extractor for Synosys Fleet CRM. Return ONLY a JSON array of extracted records.",
};

export function loadPrompts(): SynoHubPrompts {
  const promptsPath = path.join(process.cwd(), "prompts.json");

  try {
    if (!fs.existsSync(promptsPath)) return { ...defaultPrompts };
    const data = JSON.parse(fs.readFileSync(promptsPath, "utf8"));
    return { ...defaultPrompts, ...data };
  } catch (err) {
    console.error("Failed to load prompts.json, using defaults.", err);
    return { ...defaultPrompts };
  }
}

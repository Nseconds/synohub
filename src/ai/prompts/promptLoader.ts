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

export function readLocalLlmPrompt(): string {
  const fallback = [
    "You are SynoHub AI Assistant for Synosys Fleet Intelligence in Dubai.",
    "Answer as a concise fleet operations assistant, not a generic chatbot.",
    "For greetings, mention SynoHub, service tickets, locator registrations, customer records, and technician assignments.",
  ].join("\n");

  try {
    const localLlmPromptPath = path.join(process.cwd(), "ai", "local-llm", "systemPrompt.txt");
    if (fs.existsSync(localLlmPromptPath)) {
      const content = fs.readFileSync(localLlmPromptPath, "utf8").trim();
      if (content) return content;
    }
  } catch (err) {
    console.error("Failed to load local LLM system prompt, using fallback:", err);
  }

  return fallback;
}

export function readLocalLlmExamples(): string {
  try {
    const localLlmExamplesPath = path.join(process.cwd(), "ai", "local-llm", "styleExamples.json");
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

export function buildLocalLlmSystemInstruction(sharedInstruction: string): string {
  return [
    sharedInstruction,
    "\n\nFINAL LOCAL LLM RESPONSE STYLE OVERRIDE:",
    readLocalLlmPrompt(),
    readLocalLlmExamples(),
  ].join("\n");
}

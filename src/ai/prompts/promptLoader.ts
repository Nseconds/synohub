import fs from "fs";
import path from "path";

export interface SynoHubPrompts {
  chat_assistant: string;
  log_extractor: string;
  base_prompt: string;
  admin_prompt: string;
  staff_prompt: string;
  guest_prompt: string;
  compare_prompt: string;
  [key: string]: string;
}

export const defaultPrompts: SynoHubPrompts = {
  chat_assistant: "You are a SynoHub Assistant for Synosys, a fleet management SaaS company in the UAE. Assist users with CRM queries, service tickets, and registrations.",
  log_extractor: "You are a professional data extractor for Synosys Fleet CRM. Return ONLY a JSON array of extracted records.",
  base_prompt: "",
  admin_prompt: "",
  staff_prompt: "",
  guest_prompt: "",
  compare_prompt: "",
};

const modularPromptFiles = {
  base: [
    "base/identity.txt",
    "base/scope.txt",
    "base/formatting.txt",
    "base/analytics.txt",
    "base/saveRecord.txt",
    "base/statuses.txt",
    "base/customerMatching.txt",
    "base/greetings.txt",
  ],
  admin: ["admin/adminPrompt.txt"],
  staff: ["staff/staffPrompt.txt"],
  guest: ["guest/guestPrompt.txt"],
  compare: ["compare/comparePrompt.txt"],
};

function loadPromptsJson(): SynoHubPrompts {
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

function readPromptFile(promptsDir: string, relativePath: string): string {
  const filePath = path.join(promptsDir, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing modular prompt file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, "utf8").trim();
}

function joinPromptParts(parts: string[]): string {
  return parts.map(part => part.trim()).filter(Boolean).join("\n\n");
}

function loadModularPrompts(promptsJson: SynoHubPrompts): SynoHubPrompts {
  const promptsDir = path.join(process.cwd(), "src", "ai", "prompts");
  const basePrompt = joinPromptParts(modularPromptFiles.base.map(file => readPromptFile(promptsDir, file)));
  const adminPrompt = joinPromptParts(modularPromptFiles.admin.map(file => readPromptFile(promptsDir, file)));
  const staffPrompt = joinPromptParts(modularPromptFiles.staff.map(file => readPromptFile(promptsDir, file)));
  const guestPrompt = joinPromptParts(modularPromptFiles.guest.map(file => readPromptFile(promptsDir, file)));
  const comparePrompt = joinPromptParts(modularPromptFiles.compare.map(file => readPromptFile(promptsDir, file)));

  return {
    ...defaultPrompts,
    ...promptsJson,
    chat_assistant: basePrompt || promptsJson.chat_assistant || defaultPrompts.chat_assistant,
    base_prompt: basePrompt,
    admin_prompt: adminPrompt,
    staff_prompt: staffPrompt,
    guest_prompt: guestPrompt,
    compare_prompt: comparePrompt,
  };
}

export function loadPrompts(): SynoHubPrompts {
  const promptsJson = loadPromptsJson();
  try {
    return loadModularPrompts(promptsJson);
  } catch (err) {
    console.error("Failed to load modular prompt files, falling back to prompts.json.", err);
    return promptsJson;
  }
}

export function readLocalLlmPrompt(): string {
  const fallback = [
    "You are SynoHub AI Assistant for Synosys Fleet Intelligence in Dubai.",
    "Answer as a concise fleet operations assistant, not a generic chatbot.",
    "For greetings, mention SynoHub, service tickets, locator registrations, customer records, and technician assignments.",
  ].join("\n");

  try {
    const localLlmPromptPath = path.join(process.cwd(), "src", "ai", "local-llm", "systemPrompt.txt");
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
    const localLlmExamplesPaths = [
      path.join(process.cwd(), "src", "ai", "local-llm", "examples.txt"),
      path.join(process.cwd(), "src", "ai", "local-llm", "styleExamples.json"),
    ];
    const localLlmExamplesPath = localLlmExamplesPaths.find(candidate => fs.existsSync(candidate));
    if (!localLlmExamplesPath) return "";
    const content = fs.readFileSync(localLlmExamplesPath, "utf8").trim();
    if (!content) return "";

    let examples: unknown;
    try {
      examples = JSON.parse(content);
    } catch {
      return `\n\nLOCAL LLM STYLE EXAMPLES:\n${content}`;
    }

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

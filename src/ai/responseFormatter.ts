import type { SafeQueryAiMode } from "./chatService";

export function getModeScopedChatChannel(channel: string, aiMode: SafeQueryAiMode): string {
  return `${channel}|ai:${aiMode}`;
}

export function cleanVisibleAssistantText(text: string): string {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripRecordTriggers(text: string): string {
  return text
    .replace(/\[{1,2}(?:SAVE_RECORD|UPDATE_RECORD|DELETE_RECORD):.*?\]{1,2}/gs, "")
    .trim();
}

export function formatCompareChatReply(text: string): string {
  return stripRecordTriggers(text)
    .replace(/^\s*Assistant:\s*/i, "")
    .replace(/\n+\s*Example\s+\d+\s+input:\s*[\s\S]*$/i, "")
    .replace(/\n+\s*Example\s+\d+\s+good reply:\s*[\s\S]*$/i, "")
    .replace(/^.*\b(?:saving|save|created successfully|registered successfully)\b.*$/gim, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n:]+)\*:/g, "$1:")
    .replace(/\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanLocalChatReply(text: string): string {
  return text
    .replace(/^\s*Assistant:\s*/i, "")
    .replace(/\n+\s*Example\s+\d+\s+input:\s*[\s\S]*$/i, "")
    .replace(/\n+\s*Example\s+\d+\s+good reply:\s*[\s\S]*$/i, "")
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
}

export function applyStaffRequestedPersonDefault(text: string, userRole: string, userName: string): string {
  if (userRole !== "staff" || !userName) return text;
  const escapedName = userName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`Requested Person\\s*:\\s*${escapedName}\\b`, "i").test(text)) {
    return text;
  }
  return text
    .replace(/^(\s*[-•]?\s*Requested\s+(?:Person|by)\s*:\s*)$/gim, `$1${userName} (from staff login)`)
    .replace(/^(\s*[-•]?\s*Requested\s+(?:Person|by)\s*:\s*)(?:N\/A|TBD|Unknown|Not provided|Use the logged-in staff member when this is a staff session\.?)\s*$/gim, `$1${userName} (from staff login)`);
}

export function sanitizeProviderChatHistory(chatHistory: any[]): Array<{ role: "user" | "assistant"; content: string }> {
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
}

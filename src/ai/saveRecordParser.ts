export type RecordTriggerType = "SAVE_RECORD" | "UPDATE_RECORD" | "DELETE_RECORD";

export interface RecordTriggerMatch {
  fullMatch: string;
  body: string;
}

export function findRecordTrigger(reply: string, type: RecordTriggerType): RecordTriggerMatch | null {
  const match = String(reply || "").match(new RegExp(`\\[{1,2}${type}:(.*?)\\]{1,2}`, "s"));
  if (!match) return null;
  return {
    fullMatch: match[0],
    body: match[1],
  };
}

export function extractRecordTriggerJson(body: string): string {
  let rawJson = String(body || "").trim();
  const firstBrace = rawJson.indexOf("{");
  const lastBrace = rawJson.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) {
    rawJson = rawJson.substring(firstBrace, lastBrace + 1);
  }
  return rawJson;
}

export function removeRecordTrigger(reply: string, trigger: RecordTriggerMatch): string {
  return String(reply || "").replace(trigger.fullMatch, "").trim();
}

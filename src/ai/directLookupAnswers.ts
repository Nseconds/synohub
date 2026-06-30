import { desc, like } from "drizzle-orm";
import { db } from "../db";
import { serviceRequests } from "../db/schema";
import { normalizeUserName, type AuthUser } from "../auth/users";

function normalizeChatLookupText(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b(recrds|recrd|reocrds|recrods|recods)\b/g, "records")
    .replace(/\b(reqsts|reqs)\b/g, "requests")
    .trim();
}

function cleanLookupCustomerName(value: string): string {
  return String(value || "")
    .replace(/^["']|["']$/g, "")
    .replace(/\b(service\s+request|ticket|lead|record|customer)\b/gi, " ")
    .replace(/[?!.,:;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractRequestedPersonLookupCustomer(input: string, recentMessages: Array<{ content: string }> = []): string {
  const text = String(input || "");
  const normalized = normalizeChatLookupText(text);
  const isRequestedPersonLookup =
    /\brequested\s+person\b/.test(normalized) ||
    /\brequested\s+by\b/.test(normalized) ||
    /\bwho\s+requested\b/.test(normalized);

  if (!isRequestedPersonLookup) return "";

  const directPatterns = [
    /\brequested\s+person\s+(?:for|of)\s+(.+)$/i,
    /\brequested\s+by\s+(?:for|of)\s+(.+)$/i,
    /\bwho\s+(?:was|is)\s+the\s+requested\s+person\s+(?:for|of)\s+(.+)$/i,
    /\bwho\s+requested\s+(?:for\s+)?(.+)$/i,
  ];

  for (const pattern of directPatterns) {
    const match = text.match(pattern);
    const customerName = cleanLookupCustomerName(match?.[1] || "");
    if (customerName) return customerName;
  }

  for (const message of recentMessages) {
    const content = String(message.content || "");
    if (normalizeChatLookupText(content) === normalized) continue;
    const contextPatterns = [
      /\bmatching\s+"([^"]+)"/i,
      /\brecords?\s+for\s+"([^"]+)"/i,
      /\bfor\s+"([^"]+)"/i,
      /\bfor\s+([A-Za-z0-9 .&'-]{2,80})\b/i,
      /\bCustomer\s*:\s*([^\n|]+)/i,
      /\bName\s*:\s*([^\n|]+)/i,
    ];

    for (const pattern of contextPatterns) {
      const match = content.match(pattern);
      const customerName = cleanLookupCustomerName(match?.[1] || "");
      if (customerName && !/\b(requested|person|same|existing|new)\b/i.test(customerName)) {
        return customerName;
      }
    }
  }

  return "";
}

function canUserSeeServiceRow(row: any, authUser: AuthUser): boolean {
  const authName = normalizeUserName(authUser.name || "");
  if (authUser.role === "admin") return true;
  if (authUser.role === "guest") return normalizeUserName(row.createdBy || "") === authName;
  return [
    row.requestedPerson,
    row.salesPerson,
    row.createdBy,
  ].some(value => normalizeUserName(value || "") === authName);
}

export async function answerRequestedPersonLookup(
  input: string,
  authUser: AuthUser,
  recentMessages: Array<{ content: string }> = [],
): Promise<string | null> {
  const customerName = extractRequestedPersonLookupCustomer(input, recentMessages);
  if (!customerName) return null;

  const matchingRows = await db.select().from(serviceRequests)
    .where(like(serviceRequests.customerName, `%${customerName}%`))
    .orderBy(desc(serviceRequests.id))
    .limit(20);

  const visibleRows = matchingRows.filter(row => canUserSeeServiceRow(row, authUser));
  if (visibleRows.length === 0) {
    return `No visible record found for ${customerName}.`;
  }

  const requestedPeople = Array.from(new Set(visibleRows
    .map(row => String(row.requestedPerson || row.salesPerson || "").trim())
    .filter(Boolean)));

  if (requestedPeople.length === 0) {
    return `The requested person for ${visibleRows[0].customerName || customerName} is not recorded.`;
  }

  const label = visibleRows[0].customerName || customerName;
  return requestedPeople.length === 1
    ? `The requested person for ${label} is ${requestedPeople[0]}.`
    : `The requested persons for ${label} are ${requestedPeople.join(", ")}.`;
}

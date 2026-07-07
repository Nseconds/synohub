import { normalizeUserName, staffRoster, type AuthUser } from "../auth/users";

export type SafeQueryIntent =
  | "assignTicket"
  | "reassignTicket"
  | "updateTicketStatus"
  | "deleteTicket"
  | "cancelTicket"
  | "createLead"
  | "createServiceRequest"
  | "createMigrationTicket"
  | "createInstallationTicket"
  | "findCustomerByName"
  | "findCustomerByPhone"
  | "findCustomerByEmail"
  | "getPendingTicketsByStaff"
  | "getOpenTicketsByRegion"
  | "getTicketsByStaff"
  | "getTicketsByRegion"
  | "getTicketsByServiceType"
  | "getPendingTickets"
  | "getOpenTickets"
  | "getCompletedTickets"
  | "getTicketById"
  | "getTicketsByStatusLabel"
  | "getCompletedTicketsThisWeek"
  | "getTicketsNeedingAttention"
  | "getTicketsByCustomer"
  | "getOpenTicketsByCustomer"
  | "getTicketsByIssue"
  | "getUnassignedTickets"
  | "getMostCommonIssues"
  | "getCustomerWithMostRequests"
  | "getCustomerHistory"
  | "getCustomerFleetSize"
  | "getCustomerRegion"
  | "getTechnicianWorkload"
  | "getHighestWorkload"
  | "getLowestWorkload"
  | "getStaffPerformance"
  | "getDuplicateRequests"
  | "getLatestRequests"
  | "getDashboardSummary"
  | "getRegionSummary"
  | "getStatusSummary"
  | "getDailySummary"
  | "getMonthlySummary"
  | "getStaffChatHistory"
  | "getGuestChatHistory";

export interface DetectedQueryIntent {
  intent: SafeQueryIntent;
  params: Record<string, any>;
  confidence: number;
}

export interface QueryProviderResult {
  intent?: SafeQueryIntent;
  params?: Record<string, any>;
  confidence?: number;
  durationMs: number;
  error?: string;
  answer?: string;
  rowCount?: number;
}

export type SafeQueryHandlerMap = Partial<Record<SafeQueryIntent, unknown>>;

export const actionIntents = new Set<SafeQueryIntent>([
  "assignTicket",
  "reassignTicket",
  "updateTicketStatus",
  "deleteTicket",
  "cancelTicket",
  "createLead",
  "createServiceRequest",
  "createMigrationTicket",
  "createInstallationTicket",
]);


const regionAliases: Record<string, string> = {
  "auh": "Abu Dhabi",
  "ad": "Abu Dhabi",
  "abu dhabi": "Abu Dhabi",
  "dxb": "Dubai",
  "dubai": "Dubai",
  "shj": "Sharjah",
  "sharjah": "Sharjah",
  "ajman": "Ajman",
  "fujairah": "Fujairah",
  "rak": "Ras Al Khaimah",
  "ras al khaimah": "Ras Al Khaimah",
  "uaq": "Umm Al Quwain",
  "umm al quwain": "Umm Al Quwain",
};

const intentMappings: Array<{ intent: SafeQueryIntent; examples: string[] }> = [
  { intent: "assignTicket", examples: ["assign ticket 12 to athul", "assign more work to deepak", "give ticket to shamnad"] },
  { intent: "reassignTicket", examples: ["reassign ticket 3 from faizal to nishad", "re-assign ticket 6 to reyn", "move ticket to celine"] },
  { intent: "updateTicketStatus", examples: ["update ticket 5 to completed", "mark ticket 14 as hold", "change status of ticket 8 to proposed"] },
  { intent: "deleteTicket", examples: ["delete ticket 15", "remove ticket 15", "delete service request"] },
  { intent: "cancelTicket", examples: ["cancel ticket 9", "cancel service request", "cancel job"] },
  { intent: "createLead", examples: ["new lead for arkan aldar", "create lead for customer", "add customer registration"] },
  { intent: "createServiceRequest", examples: ["create new service request", "create service ticket for kleemol", "add service request"] },
  { intent: "createMigrationTicket", examples: ["create migration ticket", "new migration request", "add migrate job"] },
  { intent: "createInstallationTicket", examples: ["create installation ticket", "new installation request", "add install job"] },
  { intent: "findCustomerByName", examples: ["find customer arkan", "search customer by name", "customer named arkan", "show account arkan"] },
  { intent: "findCustomerByPhone", examples: ["find customer by phone", "search phone 050", "who has phone number", "customer mobile number"] },
  { intent: "findCustomerByEmail", examples: ["find customer by email", "search email", "customer email address", "account with email"] },
  { intent: "getCustomerHistory", examples: ["customer history for arkan", "history of arkan", "recent requests by arkan", "customer activity for arkan"] },
  { intent: "getCustomerFleetSize", examples: ["fleet size for arkan", "vehicle count for customer", "how many vehicles for arkan", "customer units count"] },
  { intent: "getCustomerRegion", examples: ["customer region for arkan", "where is arkan located", "which region is customer", "customer emirate"] },
  { intent: "getPendingTickets", examples: ["show pending tickets", "pending requests", "list pending leads", "view pending service requests"] },
  { intent: "getOpenTickets", examples: ["show open tickets", "active tickets", "ongoing requests", "unresolved service queue"] },
  { intent: "getCompletedTickets", examples: ["show completed tickets", "completed requests", "won tickets", "closed service requests"] },
  { intent: "getCompletedTicketsThisWeek", examples: ["show all completed tickets this week", "completed tickets this week", "closed requests this week"] },
  { intent: "getTicketById", examples: ["find ticket number 7", "find ticket id 18", "show ticket 12"] },
  { intent: "getTicketsByStatusLabel", examples: ["show all new lead tickets", "show hold tickets", "show proposed tickets"] },
  { intent: "getTicketsNeedingAttention", examples: ["what tickets need attention", "tickets requiring attention", "urgent service issues"] },
  { intent: "getLatestRequests", examples: ["latest 10 records", "recent tickets", "last 20 requests", "latest leads"] },
  { intent: "getPendingTicketsByStaff", examples: ["show athul pending tickets", "athul open requests", "pending tickets for celine", "nishad active leads"] },
  { intent: "getTicketsByStaff", examples: ["show athul tickets", "records for celine", "requests by nishad", "staff tickets for faiza"] },
  { intent: "getOpenTicketsByRegion", examples: ["show dubai open tickets", "abu dhabi active requests", "open tickets in sharjah", "ongoing leads in ajman"] },
  { intent: "getTicketsByRegion", examples: ["dubai tickets", "records in abu dhabi", "sharjah requests", "leads by region"] },
  { intent: "getTicketsByServiceType", examples: ["how many migrations are there", "show migration jobs", "migration tickets", "list migrate requests"] },
  { intent: "getTechnicianWorkload", examples: ["staff workload", "technician workload", "workload by technician", "team workload"] },
  { intent: "getHighestWorkload", examples: ["highest workload", "busiest technician", "who has most tickets", "most loaded staff"] },
  { intent: "getLowestWorkload", examples: ["lowest workload", "least busy technician", "who has least tickets", "available staff"] },
  { intent: "getStaffPerformance", examples: ["staff performance", "technician performance", "completed by staff", "team performance summary"] },
  { intent: "getDuplicateRequests", examples: ["duplicate requests", "duplicate tickets", "find duplicate leads", "repeated customer issues"] },
  { intent: "getDashboardSummary", examples: ["dashboard summary", "operations summary", "system snapshot", "crm summary"] },
  { intent: "getRegionSummary", examples: ["region summary", "summary by region", "emirate summary", "regional workload"] },
  { intent: "getStatusSummary", examples: ["status summary", "summary by status", "ticket status count", "lead status breakdown"] },
  { intent: "getDailySummary", examples: ["daily summary", "today summary", "daily operations", "last 7 days summary"] },
  { intent: "getMonthlySummary", examples: ["monthly summary", "this month summary", "monthly operations", "last 12 months summary"] },
  { intent: "getStaffChatHistory", examples: ["staff chat history", "show athul chat", "staff conversation history", "messages for celine"] },
  { intent: "getGuestChatHistory", examples: ["guest chat history", "guest messages", "public chat history", "guest conversation"] },
];

const queryValidationRules = {
  minCustomerSearchLength: 2,
  maxCustomerSearchLength: 160,
  maxLimit: 50,
  forbiddenForGuest: [
    "getTechnicianWorkload",
    "getHighestWorkload",
    "getLowestWorkload",
    "getStaffPerformance",
    "getDuplicateRequests",
    "getDashboardSummary",
    "getRegionSummary",
    "getStatusSummary",
    "getDailySummary",
    "getMonthlySummary",
    "getStaffChatHistory",
  ] as SafeQueryIntent[],
};

export function normalizeQueryText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIntentText(value: unknown): string {
  return normalizeQueryText(value)
    .toLowerCase()
    .replace(/\b(pednig|pendng|pendig|penidng|pendign|pendingg)\b/g, "pending")
    .replace(/\b(reocrds|recrods|recods)\b/g, "records")
    .replace(/\b(acount|accout|accoount)\b/g, "account")
}

function extractQueryLimit(text: string, fallback = 10): number {
  const match = text.toLowerCase().match(/\b(\d{1,3})\b/);
  const parsed = match ? parseInt(match[1], 10) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, 100));
}

function extractDateRange(text: string): "today" | "this_week" | "this_month" | undefined {
  const normalized = text.toLowerCase();
  if (/\b(today|today's|todays)\b/.test(normalized)) return "today";
  if (/\b(this\s+week|week|weekly)\b/.test(normalized)) return "this_week";
  if (/\b(this\s+month|month|monthly)\b/.test(normalized)) return "this_month";
  return undefined;
}

function isCountOnlyQuestion(text: string): boolean {
  return /\b(how\s+many|count|total\s+(number|count)?)\b/i.test(text);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractStaffName(text: string): string | null {
  const normalized = text.toLowerCase();
  const matched = staffRoster.find(name => {
    return new RegExp(`\\b${escapeRegex(name.toLowerCase())}\\b`).test(normalized);
  });
  return matched || null;
}

export function extractRegionName(text: string): string | null {
  const normalized = text.toLowerCase();
  const aliases = Object.entries(regionAliases).sort((a, b) => b[0].length - a[0].length);
  const matched = aliases.find(([alias]) => {
    return new RegExp(`\\b${escapeRegex(alias)}\\b`).test(normalized);
  });
  return matched ? matched[1] : null;
}

export function extractEmail(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].trim() : null;
}

export function extractPhone(text: string): string | null {
  const match = text.match(/(?:\+?\d[\d\s().-]{5,}\d)/);
  if (!match) return null;
  const phone = match[0].replace(/[^\d+]/g, "");
  return phone.length >= 6 ? phone : null;
}

function extractTicketId(text: string): number | null {
  const match = text.match(/\b(?:ticket|tickets|request|requests|id|number|#)\s*(?:id|number|no\.?)?\s*#?\s*(\d{1,10})\b/i);
  if (!match?.[1]) return null;
  const ticketId = parseInt(match[1], 10);
  return Number.isFinite(ticketId) && ticketId > 0 ? ticketId : null;
}

function extractStatusValue(text: string): string | null {
  const normalized = text.toLowerCase();
  const statusAliases: Array<[RegExp, string]> = [
    [/\bcompleted\b|\bcomplete\b|\bclosed\b|\bsolved\b/i, "Completed"],
    [/\bproposed\b|\bproposal\b/i, "Proposed"],
    [/\bhold\b|\bon hold\b/i, "Hold"],
    [/\bwon\b/i, "Won"],
    [/\bnew lead\b/i, "New Lead"],
    [/\bpending\b/i, "Pending"],
    [/\blost\b/i, "Lost"],
    [/\bduplicate\b/i, "Duplicate"],
    [/\bdeleted\b/i, "Deleted"],
  ];
  const matched = statusAliases.find(([pattern]) => pattern.test(normalized));
  return matched ? matched[1] : null;
}

function extractCreateCustomerName(text: string): string | null {
  const patterns = [
    /^new\s+lead\s+for\s+(.+?)(?:\s+contact\b|\s+(?:dubai|abu dhabi|sharjah|ajman|fujairah|rak|ras al khaimah|uaq|umm al quwain)\b|\s+(?:locator|migration|installation|service)\b|$)/i,
    /\bcreate\s+(?:new\s+)?(?:service\s+)?(?:ticket|request)\s+for\s+(.+?)(?:\s+(?:migration|installation|locator|service)\b|$)/i,
    /\bcreate\s+(?:new\s+)?(?:lead|customer)\s+for\s+(.+?)(?:\s+contact\b|\s+(?:dubai|abu dhabi|sharjah|ajman|fujairah|rak|ras al khaimah|uaq|umm al quwain)\b|\s+(?:locator|migration|installation|service)\b|$)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const customerName = match[1].trim().replace(/[.,:;?!]+$/, "");
      if (customerName) return customerName;
    }
  }
  return null;
}

function detectActionIntent(text: string): DetectedQueryIntent | null {
  const normalized = text.toLowerCase().trim();
  const isReadCommand = /\b(show|list|view|find|get|search)\b/.test(normalized);
  if (isReadCommand && /\bnew\s+lead\b/.test(normalized) && /\b(ticket|tickets|request|requests|lead|leads|record|records|job|jobs|task|tasks)\b/.test(normalized)) {
    return null;
  }

  const ticketId = extractTicketId(text);
  const staffName = extractStaffName(text);
  const region = extractRegionName(text);
  const status = extractStatusValue(text);
  const customerName = extractCreateCustomerName(text);

  if (/\breassign|re-assign\b/.test(normalized)) {
    const params: Record<string, any> = {};
    const fromMatch = text.match(/\bfrom\s+([a-zA-Z ]+?)\s+to\s+([a-zA-Z ]+)\b/i);
    const toMatch = text.match(/\bto\s+([a-zA-Z ]+)\b/i);
    if (ticketId) params.ticketId = ticketId;
    if (fromMatch?.[1] && fromMatch?.[2]) {
      params.fromStaffName = fromMatch[1].trim();
      params.staffName = fromMatch[2].trim();
    } else if (toMatch?.[1]) {
      params.staffName = toMatch[1].trim();
    } else if (staffName) {
      params.staffName = staffName;
    }
    return { intent: "reassignTicket", params, confidence: 0.95 };
  }

  if (/\bassign\b/.test(normalized)) {
    const params: Record<string, any> = {};
    if (ticketId) params.ticketId = ticketId;
    if (staffName) params.staffName = staffName;
    return { intent: "assignTicket", params, confidence: 0.94 };
  }

  if (/\b(delete|remove)\b/.test(normalized) && /\b(ticket|request|job)\b/.test(normalized)) {
    return { intent: "deleteTicket", params: ticketId ? { ticketId } : {}, confidence: 0.95 };
  }

  if (/\bcancel\b/.test(normalized) && /\b(ticket|request|job)\b/.test(normalized)) {
    return { intent: "cancelTicket", params: ticketId ? { ticketId } : {}, confidence: 0.95 };
  }

  if (/\b(update|mark|change)\b/.test(normalized) && /\b(ticket|request|job)\b/.test(normalized)) {
    const params: Record<string, any> = {};
    if (ticketId) params.ticketId = ticketId;
    if (status) params.status = status;
    return { intent: "updateTicketStatus", params, confidence: 0.94 };
  }

  if (/\b(create|add|new)\b/.test(normalized) && /\b(migration|migrate)\b/.test(normalized)) {
    return {
      intent: "createMigrationTicket",
      params: { serviceType: "migration", ...(customerName ? { customerName } : {}), ...(region ? { region } : {}) },
      confidence: 0.93,
    };
  }

  if (/\b(create|add|new)\b/.test(normalized) && /\b(installation|install)\b/.test(normalized)) {
    return {
      intent: "createInstallationTicket",
      params: { serviceType: "installation", ...(customerName ? { customerName } : {}), ...(region ? { region } : {}) },
      confidence: 0.93,
    };
  }

  if (/^new\s+lead\b/.test(normalized) || (/\b(create|add|new)\b/.test(normalized) && /\b(lead|customer|registration)\b/.test(normalized))) {
    return {
      intent: "createLead",
      params: { ...(customerName ? { customerName } : {}), ...(region ? { region } : {}) },
      confidence: 0.93,
    };
  }

  if (/\b(create|add|new)\b/.test(normalized) && /\b(service\s+)?(ticket|request)\b/.test(normalized)) {
    return {
      intent: "createServiceRequest",
      params: { ...(customerName ? { customerName } : {}), ...(region ? { region } : {}) },
      confidence: 0.92,
    };
  }

  return null;
}

function extractNamedValue(text: string): string | null {
  const patterns = [
    /\b(?:does|do|is|are)\s+(?:this\s+|the\s+)?(?:customer|account|company)\s+(?:exist|exists|available|registered|present)(?:\s+(?:in|on)\s+(?:our\s+)?(?:database|crm|system))?\s+(.+)$/i,
    /\b(?:customer|account|company)\s+(.+?)\s+(?:exist|exists|available|registered|present)\b/i,
    /\b(?:named|name|called)\s+(.+)$/i,
    /\b(?:for|of|by)\s+(.+)$/i,
    /\b(?:customer|account|company)\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = match[1].trim().replace(/[.,:;]+$/, "");
      if (value && !/^(history|region|fleet|size|phone|email)$/i.test(value)) return value;
    }
  }
  return null;
}

function extractCustomerNameFromQuery(text: string): string | null {
  const patterns = [
    /\bcustomer\s+history\s+(?:for|of)\s+(.+)$/i,
    /\bhistory\s+(?:for|of)\s+(.+)$/i,
    /\brecent\s+requests\s+(?:by|for|of)\s+(.+)$/i,
    /\brecent\s+activity\s+(?:by|for|of)\s+(.+)$/i,
    /\blast\s+(?:request|service)\s+(?:from|for|of)\s+(.+)$/i,
    /\b(?:open\s+)?(?:tickets|jobs|requests)\s+(?:for|from|of)\s+(.+)$/i,
    /\bopen\s+tickets\s+(?:by|for|of)\s+customer\s+(.+)$/i,
    /\bany\s+issues\s+with\s+(.+)$/i,
    /\bshow\s+contact\s+for\s+(.+)$/i,
    /\b(?:customer\s+details|customer\s+profile|customer\s+profile\s+for|profile)\s+(?:for\s+)?(.+)$/i,
    /\bcustomer\s+activity\s+(?:for|of)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const customerName = match[1].trim().replace(/[.,:;]+$/, "");
      if (customerName) return customerName;
    }
  }

  return null;
}

function extractIssueSearchValue(text: string): string | null {
  const normalized = text.toLowerCase();
  const issueAliases: Array<[RegExp, string]> = [
    [/\b(no\s+connection|offline\s+devices?|offline|not\s+connecting)\b/i, "no connection"],
    [/\bignition\s+issue\b|\bignition\b/i, "ignition"],
    [/\bbattery\s+low\b|\bbattery\s+issues?\b/i, "battery"],
    [/\btracker\s+not\s+working\b|\btracker\s+complaints?\b/i, "tracker not working"],
    [/\bsim\s+replacement\b|\bsim\b/i, "sim"],
    [/\breinstallation\b|\breinstall\b/i, "reinstallation"],
    [/\binstallation\s+history\b|\binstallation\b/i, "installation"],
    [/\brecurring\s+faults?\b|\bfaults?\b/i, "fault"],
  ];
  const matched = issueAliases.find(([pattern]) => pattern.test(text));
  if (matched) return matched[1];

  const vehicleMatch = text.match(/\b(?:vehicle|device)\s+(?:history\s+for\s+|details\s+for\s+|with\s+)?(.+)$/i);
  if (vehicleMatch?.[1] && /\b(vehicle|device)\b/.test(normalized)) {
    return vehicleMatch[1].trim().replace(/\b(details|history)\b$/i, "").replace(/[.,:;]+$/, "").trim();
  }

  return null;
}

export function keywordRouter(text: string): boolean {
  const normalized = text.toLowerCase();
  const explicitExampleMatch = intentMappings.some(mapping => {
    return mapping.examples.some(example => normalized.includes(example.split(" ")[0]));
  });
  return explicitExampleMatch || [
    /\b(show|list|view|find|get)\b/,
    /\b(latest|recent|last)\b/,
    /\b(pending|open|active|ongoing|unresolved)\b/,
    /\b(customer|account|company|phone|email|fleet|vehicle|region)\b/,
    /\b(completed|closed|won)\b/,
    /\b(staff|technician|performance|highest|lowest|busiest|least)\b/,
    /\bcustomer\s+history\b/,
    /\btechnician\s+workload\b/,
    /\bworkload\b/,
    /\bduplicate(s)?\b/,
    /\b(migration|migrations|migrate)\b/,
    /\bdashboard\s+summary\b/,
    /\boperations\s+summary\b/,
    /\b(chat|conversation|messages)\b/,
  ].some(pattern => pattern.test(normalized));
}

export function detectQueryIntent(text: string): DetectedQueryIntent | null {
  const normalized = normalizeIntentText(text);
  const actionIntent = detectActionIntent(text);
  if (actionIntent) return actionIntent;

  const staffName = extractStaffName(text);
  const region = extractRegionName(text);
  const customerName = extractCustomerNameFromQuery(text);
  const email = extractEmail(text);
  const phone = extractPhone(text);
  const ticketId = extractTicketId(text);
  const issueValue = extractIssueSearchValue(text);
  const dateRange = extractDateRange(text);
  const countOnly = isCountOnlyQuestion(text);
  const hasTicketWord = /\b(ticket|tickets|request|requests|lead|leads|record|records|job|jobs|task|tasks|queue|work|worklist)\b/.test(normalized);
  const hasOpenWord = /\b(pending|open|active|ongoing|unresolved|hold|new)\b/.test(normalized);
  const hasStatusFilterWord = /\b(completed|closed|won|solved|pending|open|active|ongoing|unresolved|hold|new)\b/.test(normalized);

  if (/\bpending\b/.test(normalized) && (
    /\bmy\s+pending\b/.test(normalized) ||
    /\bpending\s+(list|items?|work|worklist)\b/.test(normalized) ||
    /\b(list|show|view|get)\s+(my\s+)?pending\b/.test(normalized)
  )) {
    return {
      intent: "getPendingTickets",
      params: { limit: extractQueryLimit(text, 50), countOnly },
      confidence: 0.93,
    };
  }

  if (/\bhow\s+many\b/.test(normalized) && /\bpending\b/.test(normalized) && hasTicketWord) {
    return {
      intent: "getPendingTickets",
      params: { limit: extractQueryLimit(text, 50), countOnly },
      confidence: 0.93,
    };
  }

  if (/\bopen\b/.test(normalized) && /\b(service\s+)?requests?\b/.test(normalized) && /\btoday\b/.test(normalized)) {
    return {
      intent: "getOpenTickets",
      params: { limit: extractQueryLimit(text, 50), countOnly },
      confidence: 0.91,
    };
  }

  if (/\btoday'?s?\s+(jobs?|work|worklist)\b/.test(normalized) && /\b(all\s+)?technicians?\b/.test(normalized)) {
    return {
      intent: "getOpenTickets",
      params: { limit: extractQueryLimit(text, 50), countOnly },
      confidence: 0.91,
    };
  }

  if (dateRange === "today" && hasTicketWord && !hasStatusFilterWord) {
    return {
      intent: "getLatestRequests",
      params: { limit: extractQueryLimit(text, 10), dateRange: "today", countOnly },
      confidence: 0.94,
    };
  }

  if (/\b(most\s+common\s+(vehicle\s+)?issues?|common\s+issues?|trend\s+analysis|spot\s+check\s+patterns)\b/.test(normalized)) {
    return {
      intent: "getMostCommonIssues",
      params: { limit: extractQueryLimit(text, 20), dateRange },
      confidence: 0.92,
    };
  }

  if (ticketId && /\b(find|show|view|get|search)\b/.test(normalized)) {
    return {
      intent: "getTicketById",
      params: { ticketId },
      confidence: 0.97,
    };
  }

  if (/\b(unassigned|without\s+assignee|no\s+assignee)\b/.test(normalized) && /\b(ticket|tickets|job|jobs|request|requests|count|queue)\b/.test(normalized)) {
    return {
      intent: "getUnassignedTickets",
      params: { limit: extractQueryLimit(text, 50), dateRange, countOnly },
      confidence: 0.94,
    };
  }

  if (/\b(who\s+is\s+free|free\s+today|available\s+technician|available\s+staff|least\s+workload|lowest\s+workload|overload|overloaded)\b/.test(normalized)) {
    return {
      intent: /\boverload|overloaded\b/.test(normalized) ? "getHighestWorkload" : "getLowestWorkload",
      params: { limit: /\boverload|overloaded\b/.test(normalized) ? 3 : 3 },
      confidence: 0.93,
    };
  }

  if (/\bperformance\s+report\s+for\s+technicians\b/.test(normalized)) {
    return {
      intent: "getStaffPerformance",
      params: { limit: extractQueryLimit(text, 25) },
      confidence: 0.92,
    };
  }

  if (/\b(balance|rebalance|workload\s+analysis|technician\s+overload)\b/.test(normalized)) {
    return {
      intent: "getTechnicianWorkload",
      params: { limit: extractQueryLimit(text, 25) },
      confidence: 0.92,
    };
  }

  if (/\b(migration|migrations|migrate)\b/.test(normalized) && /\b(show|list|view|get|find|recent|latest|history|how\s+many|count|total|ticket|tickets|request|requests|job|jobs|task|tasks|there)\b/.test(normalized)) {
    return {
      intent: "getTicketsByServiceType",
      params: { serviceType: "migration", limit: extractQueryLimit(text, 50), dateRange, countOnly },
      confidence: 0.94,
    };
  }

  if (staffName && /\b(working\s+on|current\s+workload|workload|tasks?|jobs?|assigned|tickets?)\b/.test(normalized)) {
    return {
      intent: "getTicketsByStaff",
      params: { staffName, limit: extractQueryLimit(text, 25), countOnly },
      confidence: 0.94,
    };
  }

  if (staffName && hasTicketWord) {
    return {
      intent: hasOpenWord ? "getPendingTicketsByStaff" : "getTicketsByStaff",
      params: { staffName, limit: extractQueryLimit(text, 25), countOnly },
      confidence: hasOpenWord ? 0.98 : 0.93,
    };
  }

  if (customerName && /\bopen|active|pending|ongoing|unresolved\b/.test(normalized) && /\b(ticket|tickets|job|jobs|request|requests)\b/.test(normalized)) {
    return {
      intent: "getOpenTicketsByCustomer",
      params: { customerName, limit: extractQueryLimit(text, 50), dateRange, countOnly },
      confidence: 0.95,
    };
  }

  if (customerName && /\bshow\s+contact\s+for\b/.test(normalized)) {
    return {
      intent: "findCustomerByName",
      params: { value: customerName, limit: extractQueryLimit(text, 10) },
      confidence: 0.9,
    };
  }

  if (customerName && /\b(customer\s+details|customer\s+profile|profile)\b/.test(normalized)) {
    return {
      intent: "findCustomerByName",
      params: { value: customerName, limit: extractQueryLimit(text, 10) },
      confidence: 0.9,
    };
  }

  if (customerName && /\b(ticket|tickets|job|jobs|request|requests|service|activity|history|issue|issues)\b/.test(normalized)) {
    return {
      intent: /\bhistory|activity|last|recent\b/.test(normalized) ? "getCustomerHistory" : "getTicketsByCustomer",
      params: { customerName, limit: extractQueryLimit(text, 50), dateRange, countOnly },
      confidence: 0.94,
    };
  }

  if (/\b(most\s+common\s+(vehicle\s+)?issues?|common\s+issues?|trend\s+analysis|spot\s+check\s+patterns)\b/.test(normalized)) {
    return {
      intent: "getMostCommonIssues",
      params: { limit: extractQueryLimit(text, 20), dateRange },
      confidence: 0.92,
    };
  }

  if (issueValue && /\b(search|show|which|history|requests?|issues?|complaints?|faults?|devices?|vehicles?|details|summary|common)\b/.test(normalized)) {
    return {
      intent: "getTicketsByIssue",
      params: { value: issueValue, region, limit: extractQueryLimit(text, 50), dateRange, countOnly },
      confidence: 0.93,
    };
  }

  if (/^(show|list|view)$/.test(normalized)) {
    return {
      intent: "getLatestRequests",
      params: { limit: 10 },
      confidence: 0.82,
    };
  }

  if (/\bchat|conversation|messages?\b/.test(normalized)) {
    if (/\bguest|public\b/.test(normalized)) {
      return {
        intent: "getGuestChatHistory",
        params: { limit: extractQueryLimit(text, 25) },
        confidence: 0.92,
      };
    }
    if (/\bstaff|technician\b/.test(normalized) || staffName) {
      return {
        intent: "getStaffChatHistory",
        params: { channelName: staffName ? `staff:${staffName}` : undefined, limit: extractQueryLimit(text, 25) },
        confidence: 0.92,
      };
    }
  }

  if (email && /\b(customer|account|company|email)\b/.test(normalized)) {
    return {
      intent: "findCustomerByEmail",
      params: { value: email, limit: extractQueryLimit(text, 10) },
      confidence: 0.97,
    };
  }

  if (phone && /\b(customer|account|company|phone|mobile|number)\b/.test(normalized)) {
    return {
      intent: "findCustomerByPhone",
      params: { value: phone, limit: extractQueryLimit(text, 10) },
      confidence: 0.97,
    };
  }

  if (/\b(fleet\s+size|vehicle\s+count|vehicles|units)\b/.test(normalized)) {
    const value = customerName || extractNamedValue(text);
    if (value) {
      return {
        intent: "getCustomerFleetSize",
        params: { customerName: value, limit: extractQueryLimit(text, 10) },
        confidence: 0.94,
      };
    }
  }

  if (/\b(customer|account|company)\b/.test(normalized) && /\b(region|emirate|location|located|where)\b/.test(normalized)) {
    const value = customerName || extractNamedValue(text);
    if (value) {
      return {
        intent: "getCustomerRegion",
        params: { customerName: value, limit: extractQueryLimit(text, 10) },
        confidence: 0.94,
      };
    }
  }

  if (customerName) {
    return {
      intent: "getCustomerHistory",
      params: { customerName, limit: extractQueryLimit(text, 25) },
      confidence: 0.96,
    };
  }

  if (/\b(customer|account|company)\b/.test(normalized) && /\b(find|search|show|get|view|exist|exists|available|registered|present)\b/.test(normalized)) {
    const value = extractNamedValue(text);
    if (value) {
      return {
        intent: "findCustomerByName",
        params: { value, limit: extractQueryLimit(text, 10) },
        confidence: 0.9,
      };
    }
  }

  if (/\b(search|find|show\s+contact\s+for)\b/.test(normalized)) {
    const value = extractNamedValue(text) || text.replace(/^\s*(search\s+for|search|find|show\s+contact\s+for)\s+/i, "").trim().replace(/[?!.,:;]+$/, "");
    if (value.length >= 2 && value.length <= 160) {
      return {
        intent: "findCustomerByName",
        params: { value, limit: extractQueryLimit(text, 10) },
        confidence: 0.89,
      };
    }
  }

  if (staffName && hasTicketWord && hasOpenWord) {
    return {
      intent: "getPendingTicketsByStaff",
      params: { staffName, limit: extractQueryLimit(text, 25), countOnly },
      confidence: 0.98,
    };
  }

  if (region && hasTicketWord && hasOpenWord) {
    return {
      intent: "getOpenTicketsByRegion",
      params: { region, limit: extractQueryLimit(text, 10), dateRange, countOnly, latest: /\b(latest|recent|last)\b/.test(normalized) },
      confidence: 0.97,
    };
  }

  if (region && hasTicketWord) {
    return {
      intent: "getTicketsByRegion",
      params: { region, limit: extractQueryLimit(text, 10), dateRange, countOnly, latest: /\b(latest|recent|last)\b/.test(normalized) },
      confidence: 0.92,
    };
  }

  if (/\b(highest|busiest|most\s+loaded|most\s+tickets|maximum\s+workload)\b/.test(normalized)) {
    return {
      intent: "getHighestWorkload",
      params: { limit: 1 },
      confidence: 0.93,
    };
  }

  if (/\b(lowest|least\s+busy|least\s+loaded|least\s+tickets|minimum\s+workload|available\s+staff)\b/.test(normalized)) {
    return {
      intent: "getLowestWorkload",
      params: { limit: 1 },
      confidence: 0.93,
    };
  }

  if (/\b(staff|technician|team)\b/.test(normalized) && /\b(performance|completed|productivity)\b/.test(normalized)) {
    return {
      intent: "getStaffPerformance",
      params: { limit: extractQueryLimit(text, 25) },
      confidence: 0.92,
    };
  }

  if (/\b(technician\s+workload|workload\s+by\s+technician|workload)\b/.test(normalized)) {
    return {
      intent: "getTechnicianWorkload",
      params: { limit: extractQueryLimit(text, 25) },
      confidence: 0.92,
    };
  }

  if (/\b(duplicate|duplicates|duplicate\s+requests|duplicate\s+tickets)\b/.test(normalized)) {
    return {
      intent: "getDuplicateRequests",
      params: { limit: extractQueryLimit(text, 25) },
      confidence: 0.92,
    };
  }

  if (/\b(need|needs|requiring|require|requires)\s+attention\b/.test(normalized) || /\battention\s+(ticket|tickets|request|requests|queue)\b/.test(normalized)) {
    return {
      intent: "getTicketsNeedingAttention",
      params: { limit: extractQueryLimit(text, 50), countOnly },
      confidence: 0.93,
    };
  }

  if (/\bcustomer\s+with\s+most\s+requests\b|\bhigh\s+priority\s+customers\b/.test(normalized)) {
    return {
      intent: "getCustomerWithMostRequests",
      params: { limit: extractQueryLimit(text, 20), dateRange },
      confidence: 0.92,
    };
  }

  if (/\b(region|regional|emirate)\b/.test(normalized) && /\b(summary|breakdown|count|workload)\b/.test(normalized)) {
    return {
      intent: "getRegionSummary",
      params: { region, limit: extractQueryLimit(text, 25), dateRange },
      confidence: 0.91,
    };
  }

  if (/\b(status)\b/.test(normalized) && /\b(summary|breakdown|count)\b/.test(normalized)) {
    return {
      intent: "getStatusSummary",
      params: { limit: extractQueryLimit(text, 25), dateRange },
      confidence: 0.91,
    };
  }

  if (/\b(daily|today|day)\b/.test(normalized) && /\b(summary|snapshot|operations|report)\b/.test(normalized)) {
    return {
      intent: "getDailySummary",
      params: { limit: extractQueryLimit(text, 7) },
      confidence: 0.91,
    };
  }

  if (/\b(monthly|month)\b/.test(normalized) && /\b(summary|snapshot|operations|report)\b/.test(normalized)) {
    return {
      intent: "getMonthlySummary",
      params: { limit: extractQueryLimit(text, 12) },
      confidence: 0.91,
    };
  }

  if (/\b(completed|closed|won|solved)\b/.test(normalized) && /\btoday\b/.test(normalized) && hasTicketWord) {
    return {
      intent: "getCompletedTickets",
      params: { limit: extractQueryLimit(text, 50), dateRange: "today", countOnly },
      confidence: 0.92,
    };
  }

  if (/\bfull\s+service\s+queue\b/.test(normalized)) {
    return {
      intent: "getOpenTickets",
      params: { limit: extractQueryLimit(text, 50) },
      confidence: 0.91,
    };
  }

  if (/\b(alerts?|sla|risks?|recommended\s+actions)\b/.test(normalized)) {
    return {
      intent: "getTicketsNeedingAttention",
      params: { limit: extractQueryLimit(text, 50), countOnly },
      confidence: 0.91,
    };
  }

  if (/\bweekly\s+summary\b/.test(normalized)) {
    return {
      intent: "getDailySummary",
      params: { limit: 7 },
      confidence: 0.91,
    };
  }

  if (
    /\b(dashboard\s+summary|operations\s+summary|summary|snapshot)\b/.test(normalized) ||
    /\b(full\s+overview|overall\s+fleet\s+status|operational\s+dashboard|service\s+statistics|queue\s+snapshot|recommended\s+actions)\b/.test(normalized) ||
    /\b(trend\s+analysis|spot\s+check\s+patterns|high\s+priority\s+customers)\b/.test(normalized) ||
    (/\b(total|count|how\s+many|overall)\b/.test(normalized) && /\b(record|records|ticket|tickets|request|requests|lead|leads|customer|customers|database|crm|system)\b/.test(normalized))
  ) {
    return {
      intent: "getDashboardSummary",
      params: { dateRange },
      confidence: 0.9,
    };
  }

  if (/\b(completed|closed|won|solved)\b/.test(normalized) && /\b(this\s+week|week)\b/.test(normalized) && hasTicketWord) {
    return {
      intent: "getCompletedTicketsThisWeek",
      params: { limit: extractQueryLimit(text, 50), dateRange: "this_week", countOnly },
      confidence: 0.94,
    };
  }

  if (/\bnew\s+lead\b/.test(normalized) && hasTicketWord && /\b(show|list|view|get|find)\b/.test(normalized)) {
    return {
      intent: "getTicketsByStatusLabel",
      params: { statusLabel: "new lead", limit: extractQueryLimit(text, 50) },
      confidence: 0.94,
    };
  }

  if (/\b(completed|closed|won|solved)\b/.test(normalized) && hasTicketWord) {
    return {
      intent: "getCompletedTickets",
      params: { limit: extractQueryLimit(text, 10), dateRange, countOnly },
      confidence: 0.93,
    };
  }

  if (/\b(pending)\b/.test(normalized) && (hasTicketWord || /\b(can\s+i\s+know|what|how\s+many|status|queue)\b/.test(normalized))) {
    return {
      intent: "getPendingTickets",
      params: { limit: extractQueryLimit(text, 50), dateRange, countOnly },
      confidence: 0.93,
    };
  }

  if (hasOpenWord && (hasTicketWord || /\b(can\s+i\s+know|what|how\s+many|status|queue)\b/.test(normalized))) {
    return {
      intent: "getOpenTickets",
      params: { limit: extractQueryLimit(text, 50), dateRange, countOnly },
      confidence: 0.91,
    };
  }

  if (/\b(latest|last|recent)\s+(\d{1,3}\s+)?(record|records|request|requests|ticket|tickets|lead|leads)\b/.test(normalized)) {
    return {
      intent: "getLatestRequests",
      params: { limit: extractQueryLimit(text, 10) },
      confidence: 0.94,
    };
  }

  if (/\b(show|list|view)\s+(my\s+)?(record|records|request|requests|ticket|tickets|lead|leads)\b/.test(normalized)) {
    return {
      intent: "getLatestRequests",
      params: { limit: extractQueryLimit(text, 10) },
      confidence: 0.86,
    };
  }

  return null;
}

export function validateQueryIntent(detected: DetectedQueryIntent | null, safeQueryHandlers: SafeQueryHandlerMap): DetectedQueryIntent {
  if (!detected || !safeQueryHandlers[detected.intent]) {
    throw Object.assign(new Error("Unsupported query intent."), { statusCode: 400 });
  }
  return detected;
}

export function normalizeDetectedIntentName(intent: unknown, safeQueryHandlers: SafeQueryHandlerMap): SafeQueryIntent | "unknown" {
  const mapped: Record<string, SafeQueryIntent> = {
    getRecordsByStaff: "getTicketsByStaff",
    getRecordsByRegion: "getTicketsByRegion",
    getMyPendingTickets: "getPendingTickets",
    getLatestRecords: "getLatestRequests",
  };
  const raw = String(intent || "");
  const normalized = mapped[raw] || raw;
  return safeQueryHandlers[normalized as SafeQueryIntent] ? normalized as SafeQueryIntent : "unknown";
}

function containsUnsafeSqlText(value: unknown): boolean {
  const raw = typeof value === "string" ? value : JSON.stringify(value || "");
  return /\b(select\s+.+\s+from|update\s+\w+\s+set|delete\s+from|insert\s+into|drop\s+table|alter\s+table|create\s+table|truncate\s+table|execute\s+\w+|join\s+\w+\s+on)\b/i.test(raw);
}

export function parseProviderIntent(raw: string, safeQueryHandlers: SafeQueryHandlerMap): DetectedQueryIntent {
  if (containsUnsafeSqlText(raw)) {
    throw new Error("Provider response contained forbidden database language.");
  }

  const cleaned = raw.replace(/```json|```/gi, "").trim();
  const parsed = JSON.parse(cleaned);
  if (containsUnsafeSqlText(parsed)) {
    throw new Error("Provider response contained forbidden database language.");
  }

  const intent = normalizeDetectedIntentName(parsed.intent, safeQueryHandlers);
  if (intent === "unknown") {
    throw new Error("Provider returned an unsupported intent.");
  }

  return {
    intent,
    params: parsed.params && typeof parsed.params === "object" ? parsed.params : {},
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(parsed.confidence, 1)) : 0.5,
  };
}


export function providerToDetected(result: QueryProviderResult): DetectedQueryIntent | null {
  if (result.error || !result.intent) return null;
  return {
    intent: result.intent,
    params: result.params || {},
    confidence: typeof result.confidence === "number" ? result.confidence : 0.5,
  };
}


export function validateQueryParams(detected: DetectedQueryIntent, authUser: AuthUser): Record<string, any> {
  const params = { ...detected.params };
  const normalizedAuthName = normalizeUserName(authUser.name);

  if (actionIntents.has(detected.intent)) {
    const createActionIntents = new Set<SafeQueryIntent>([
      "createLead",
      "createServiceRequest",
      "createMigrationTicket",
      "createInstallationTicket",
    ]);
    const staffDeniedActionIntents = new Set<SafeQueryIntent>([
      "assignTicket",
      "reassignTicket",
      "updateTicketStatus",
      "deleteTicket",
      "cancelTicket",
    ]);
    const guestDeniedActionIntents = new Set<SafeQueryIntent>([
      "assignTicket",
      "reassignTicket",
      "updateTicketStatus",
      "deleteTicket",
      "cancelTicket",
    ]);

    if (authUser.role === "staff" && staffDeniedActionIntents.has(detected.intent)) {
      throw Object.assign(new Error("Access restricted. Staff users can classify this action, but cannot execute or authorize ticket assignment, reassignment, status update, cancellation, or deletion from this endpoint."), { statusCode: 403 });
    }

    if (authUser.role === "guest" && guestDeniedActionIntents.has(detected.intent)) {
      throw Object.assign(new Error("Access restricted. Guest users cannot assign, reassign, update, cancel, or delete tickets."), { statusCode: 403 });
    }

    if (authUser.role === "guest" && !createActionIntents.has(detected.intent)) {
      throw Object.assign(new Error("Access restricted. Guest users can only classify limited create-record actions."), { statusCode: 403 });
    }

    if (params.ticketId !== undefined) {
      const ticketId = Number(params.ticketId);
      if (Number.isInteger(ticketId) && ticketId > 0) {
        params.ticketId = ticketId;
      } else {
        delete params.ticketId;
      }
    }
    if (typeof params.staffName === "string") {
      const canonicalStaff = staffRoster.find(name => name.toLowerCase() === params.staffName.trim().toLowerCase());
      params.staffName = canonicalStaff || params.staffName.trim();
    }
    if (typeof params.fromStaffName === "string") {
      const canonicalStaff = staffRoster.find(name => name.toLowerCase() === params.fromStaffName.trim().toLowerCase());
      params.fromStaffName = canonicalStaff || params.fromStaffName.trim();
    }
    if (typeof params.status === "string") {
      params.status = params.status.trim();
    }
    if (typeof params.customerName === "string") {
      params.customerName = params.customerName.trim().replace(/[?!.,:;]+$/, "");
    }
    if (typeof params.region === "string") {
      const canonicalRegion = Object.values(regionAliases).find(value => value.toLowerCase() === params.region.trim().toLowerCase());
      if (canonicalRegion) params.region = canonicalRegion;
    }
    return params;
  }

  if (params.limit !== undefined) {
    params.limit = extractQueryLimit(String(params.limit), 10);
  }

  if (params.dateRange !== undefined && !["today", "this_week", "this_month"].includes(String(params.dateRange))) {
    delete params.dateRange;
  }

  if (params.countOnly !== undefined) {
    params.countOnly = params.countOnly === true || String(params.countOnly).toLowerCase() === "true";
  }

  if (["getPendingTicketsByStaff", "getTicketsByStaff"].includes(detected.intent)) {
    const staffName = typeof params.staffName === "string" ? params.staffName.trim() : "";
    const canonicalStaff = staffRoster.find(name => name.toLowerCase() === staffName.toLowerCase());
    if (!canonicalStaff) {
      throw Object.assign(new Error("Invalid staff name for query."), { statusCode: 400 });
    }
    if (authUser.role === "staff" && canonicalStaff.toLowerCase() !== normalizedAuthName) {
      throw Object.assign(new Error("Access restricted. Staff users can only query their own records."), { statusCode: 403 });
    }
    if (authUser.role === "guest") {
      throw Object.assign(new Error("Access restricted. Guest users cannot query staff tickets."), { statusCode: 403 });
    }
    params.staffName = canonicalStaff;
  }

  if (["getOpenTicketsByRegion", "getTicketsByRegion", "getRegionSummary"].includes(detected.intent)) {
    const region = typeof params.region === "string" ? params.region.trim() : "";
    const canonicalRegion = region
      ? Object.values(regionAliases).find(value => value.toLowerCase() === region.toLowerCase())
      : undefined;
    if (["getOpenTicketsByRegion", "getTicketsByRegion"].includes(detected.intent) && !canonicalRegion) {
      throw Object.assign(new Error("Invalid region for query."), { statusCode: 400 });
    }
    if (canonicalRegion) {
      params.region = canonicalRegion;
    } else {
      delete params.region;
    }
  }

  if (detected.intent === "getTicketsByIssue" && params.region !== undefined) {
    const region = typeof params.region === "string" ? params.region.trim() : "";
    const canonicalRegion = Object.values(regionAliases).find(value => value.toLowerCase() === region.toLowerCase());
    if (canonicalRegion) {
      params.region = canonicalRegion;
    } else {
      delete params.region;
    }
  }

  if (detected.intent === "getTicketsByServiceType") {
    const requestedType = typeof params.serviceType === "string" ? params.serviceType.trim().toLowerCase() : "";
    const serviceTypeAliases: Record<string, string> = {
      migration: "migration",
      migrations: "migration",
      migrate: "migration",
      locator: "locator",
      locators: "locator",
      service: "service",
      installation: "installation",
      install: "installation",
      reinstallation: "reinstallation",
      reinstall: "reinstallation",
      removal: "removal",
      "device removal": "removal",
    };
    const canonicalServiceType = serviceTypeAliases[requestedType];
    if (!canonicalServiceType) {
      throw Object.assign(new Error("Invalid service type for query."), { statusCode: 400 });
    }
    params.serviceType = canonicalServiceType;
  }

  if (detected.intent === "getTicketById") {
    const ticketId = Number(params.ticketId);
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      throw Object.assign(new Error("Invalid ticket ID for query."), { statusCode: 400 });
    }
    params.ticketId = ticketId;
  }

  if (detected.intent === "getTicketsByStatusLabel") {
    const requestedStatus = typeof params.statusLabel === "string" ? params.statusLabel.trim().toLowerCase() : "";
    const statusAliases: Record<string, string> = {
      "new lead": "new lead",
      new: "new",
      hold: "hold",
      proposed: "proposed",
      won: "won",
      completed: "completed",
      closed: "completed",
      solved: "completed",
      pending: "pending",
    };
    const canonicalStatus = statusAliases[requestedStatus];
    if (!canonicalStatus) {
      throw Object.assign(new Error("Invalid status for query."), { statusCode: 400 });
    }
    params.statusLabel = canonicalStatus;
  }

  if (["getCustomerHistory", "getCustomerFleetSize", "getCustomerRegion", "getTicketsByCustomer", "getOpenTicketsByCustomer"].includes(detected.intent)) {
    const customerName = typeof params.customerName === "string" ? params.customerName.trim().replace(/[?!.,:;]+$/, "") : "";
    if (customerName.length < queryValidationRules.minCustomerSearchLength || customerName.length > queryValidationRules.maxCustomerSearchLength) {
      throw Object.assign(new Error("Invalid customer name for query."), { statusCode: 400 });
    }
    params.customerName = customerName;
  }

  if (detected.intent === "getTicketsByIssue") {
    const value = typeof params.value === "string" ? params.value.trim() : "";
    if (value.length < 2 || value.length > 160) {
      throw Object.assign(new Error("Invalid issue search value."), { statusCode: 400 });
    }
    params.value = value;
  }

  if (["findCustomerByName", "findCustomerByPhone", "findCustomerByEmail"].includes(detected.intent)) {
    const value = typeof params.value === "string" ? params.value.trim() : "";
    if (value.length < 2 || value.length > 160) {
      throw Object.assign(new Error("Invalid customer search value."), { statusCode: 400 });
    }
    params.value = value;
  }

  if (detected.intent === "getStaffChatHistory") {
    if (authUser.role === "guest") {
      throw Object.assign(new Error("Access restricted. Guest users cannot query staff chat history."), { statusCode: 403 });
    }
    if (params.channelName && authUser.role === "staff") {
      const requestedStaff = String(params.channelName).replace(/^staff:/i, "").trim();
      if (requestedStaff.toLowerCase() !== normalizedAuthName) {
        throw Object.assign(new Error("Access restricted. Staff users can only query their own chat history."), { statusCode: 403 });
      }
    }
  }

  if (detected.intent === "getGuestChatHistory" && authUser.role === "staff") {
    throw Object.assign(new Error("Access restricted. Staff users cannot query guest chat history."), { statusCode: 403 });
  }

  if (authUser.role === "guest" && queryValidationRules.forbiddenForGuest.includes(detected.intent)) {
    throw Object.assign(new Error("Access restricted. Guest users can only query records created by their account."), { statusCode: 403 });
  }

  return params;
}

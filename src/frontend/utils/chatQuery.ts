import { REQUESTED_PEOPLE } from "../constants/options";

export const normalizeQueryText = (text: string) => {
  return text
    .toLowerCase()
    .replace(/\b(pednig|pendng|pendig|penidng|pendign|pendingg)\b/g, "pending")
    .replace(/\b(recrds|recrd|reocrds|recrods|recods)\b/g, "records")
    .replace(/\b(acount|accout|accoount)\b/g, "account");
};

export const isSafeQueryMessage = (text: string) => {
  const normalized = normalizeQueryText(text).trim();
  if (/\b(update|assign|reassign|re-assign|cancel|delete|create|mark|change)\b/.test(normalized) || /^new\s+lead\b/.test(normalized)) return false;
  if (/^(show|list|view)$/.test(normalized)) return true;
  if (/\bpending\b/.test(normalized) && /\b(my|list|account|ticket|tickets|request|requests|lead|leads|queue)\b/.test(normalized)) return true;
  if (/\b(pending|open|active|ongoing|unresolved)\b/.test(normalized) && !/\b(create|register|add|new|save|file)\b/.test(normalized)) return true;
  if (/\b(today|today's|todays)\b/.test(normalized) && /\b(record|records|ticket|tickets|request|requests|lead|leads|job|jobs|task|tasks|work|worklist)\b/.test(normalized)) return true;
  if (/\b(migration|migrations|migrate)\b/.test(normalized) && /\b(show|list|view|get|find|how\s+many|count|total|ticket|tickets|request|requests|job|jobs|task|tasks|there)\b/.test(normalized)) return true;
  if (/\b(find|show|view|get|search)\b/.test(normalized) && /\b(ticket|request)\b.*\b(id|number|#)?\s*\d+\b/.test(normalized)) return true;
  if (/\b(need|needs|requiring|require|requires)\s+attention\b/.test(normalized) || /\battention\s+(ticket|tickets|request|requests|queue)\b/.test(normalized)) return true;
  if (/\b(unassigned|free\s+today|available|overload|overloaded|balance|rebalance|workload\s+analysis)\b/.test(normalized)) return true;
  if (/\b(customer\s+profile|customer\s+details|last\s+request|last\s+service|recent\s+activity|open\s+(tickets|jobs)|tickets\s+for|jobs\s+for)\b/.test(normalized)) return true;
  if (/\b(no\s+connection|ignition|battery\s+low|battery\s+issues?|tracker\s+not\s+working|offline|sim\s+replacement|recurring\s+faults?|vehicle\s+history|device\s+history|migration\s+history|reinstallation|installation\s+history|common\s+issues?)\b/.test(normalized)) return true;
  if (/\b(sla|alerts?|trend\s+analysis|queue\s+snapshot|operational\s+dashboard|service\s+statistics|full\s+overview|overall\s+fleet\s+status|recommended\s+actions|high\s+priority\s+customers)\b/.test(normalized)) return true;
  if (/\b(customer|account|company)\b/.test(normalized) && /\b(exist|exists|available|registered|present|in\s+(?:our\s+)?database)\b/.test(normalized)) return true;
  const mentionsStaff = REQUESTED_PEOPLE.some(name => new RegExp(`\\b${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(normalized));
  if (mentionsStaff && /\b(record|records|ticket|tickets|request|requests|lead|leads|job|jobs|task|tasks|workload|working\s+on|assigned)\b/.test(normalized)) return true;
  if (/\b(total|count|how\s+many|overall)\b/.test(normalized) && /\b(record|records|ticket|tickets|request|requests|lead|leads|job|jobs|task|tasks|customer|customers|database|crm|system)\b/.test(normalized)) return true;
  const hasQueryAction = /\b(show|list|view|find|get|search|latest|recent|last|pending|open|completed|closed|history|summary|workload|duplicate|highest|lowest|total|count|attention)\b/.test(normalized);
  const hasQueryObject = /\b(ticket|tickets|request|requests|lead|leads|record|records|job|jobs|task|tasks|migration|migrations|migrate|customer|customers|account|company|staff|technician|region|status|dashboard|chat|messages|fleet|vehicle|vehicles|device|devices|issue|issues|fault|faults|phone|email|database|crm|system)\b/.test(normalized);
  return hasQueryAction && hasQueryObject;
};

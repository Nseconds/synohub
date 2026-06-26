#!/usr/bin/env python3
"""
Safe SynoHub intent detector.

The detector only returns intent JSON. It never generates SQL, executes SQL,
connects to a database, reads credentials, formats database answers, or
invents records.
"""

import json
import re
import sys
from typing import Any, Dict, List, Optional


STAFF_NAMES = [
    "Ajmal", "Amrutha", "Athul", "Celine", "Deepak", "Faizal", "Ivy", "Midhun",
    "Mohamed Musthafa", "Naseeb", "Nishad", "Rasick", "Reyn", "Shamnad", "Shams", "Shyamjith"
]

REGION_ALIASES = {
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
}

BACKEND_INTENTS = {
    "assignTicket",
    "reassignTicket",
    "updateTicketStatus",
    "deleteTicket",
    "cancelTicket",
    "createLead",
    "createServiceRequest",
    "createMigrationTicket",
    "createInstallationTicket",
    "findCustomerByName",
    "findCustomerByPhone",
    "findCustomerByEmail",
    "getPendingTicketsByStaff",
    "getOpenTicketsByRegion",
    "getTicketsByStaff",
    "getTicketsByRegion",
    "getTicketsByServiceType",
    "getPendingTickets",
    "getOpenTickets",
    "getCompletedTickets",
    "getTicketById",
    "getTicketsByStatusLabel",
    "getCompletedTicketsThisWeek",
    "getTicketsNeedingAttention",
    "getTicketsByCustomer",
    "getOpenTicketsByCustomer",
    "getTicketsByIssue",
    "getUnassignedTickets",
    "getMostCommonIssues",
    "getCustomerWithMostRequests",
    "getCustomerHistory",
    "getCustomerFleetSize",
    "getCustomerRegion",
    "getTechnicianWorkload",
    "getHighestWorkload",
    "getLowestWorkload",
    "getStaffPerformance",
    "getDuplicateRequests",
    "getLatestRequests",
    "getDashboardSummary",
    "getRegionSummary",
    "getStatusSummary",
    "getDailySummary",
    "getMonthlySummary",
    "getStaffChatHistory",
    "getGuestChatHistory",
}


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def lower_text(text: str) -> str:
    return normalize_text(text).lower()


def out(intent: str, params: Optional[Dict[str, Any]] = None, confidence: float = 0.9) -> Dict[str, Any]:
    if intent not in BACKEND_INTENTS:
        return {"intent": "unknown", "params": {}, "confidence": 0.0}
    return {"intent": intent, "params": params or {}, "confidence": confidence}


def canonical_staff_name(text: str) -> Optional[str]:
    normalized = lower_text(text)
    for name in STAFF_NAMES:
        if re.search(rf"\b{re.escape(name.lower())}\b", normalized):
            return name
    return None


def canonical_region(text: str) -> Optional[str]:
    normalized = lower_text(text)
    for alias, region in sorted(REGION_ALIASES.items(), key=lambda item: len(item[0]), reverse=True):
        if re.search(rf"\b{re.escape(alias)}\b", normalized):
            return region
    return None


def extract_limit(text: str, default: int = 10, maximum: int = 50) -> int:
    match = re.search(r"\b(\d{1,3})\b", lower_text(text))
    if not match:
        return default
    return max(1, min(int(match.group(1)), maximum))


def extract_date_range(text: str) -> Optional[str]:
    normalized = lower_text(text)
    if re.search(r"\b(today|today's)\b", normalized):
        return "today"
    if re.search(r"\b(this\s+week|week|weekly)\b", normalized):
        return "this_week"
    if re.search(r"\b(this\s+month|month|monthly)\b", normalized):
        return "this_month"
    return None


def is_count_only_question(text: str) -> bool:
    return bool(re.search(r"\b(how\s+many|count|total\s+(number|count)?)\b", lower_text(text)))


def extract_email(text: str) -> Optional[str]:
    match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, flags=re.I)
    return match.group(0).strip() if match else None


def extract_phone(text: str) -> Optional[str]:
    match = re.search(r"(?:\+?\d[\d\s().-]{5,}\d)", text)
    if not match:
        return None
    phone = re.sub(r"[^\d+]", "", match.group(0))
    return phone if len(phone) >= 6 else None


def extract_ticket_id(text: str) -> Optional[int]:
    match = re.search(r"\b(?:ticket|tickets|request|requests|id|number|#)\s*(?:id|number|no\.?)?\s*#?\s*(\d{1,10})\b", text, flags=re.I)
    if not match:
        return None
    ticket_id = int(match.group(1))
    return ticket_id if ticket_id > 0 else None


def extract_status(text: str) -> Optional[str]:
    normalized = lower_text(text)
    status_aliases = [
        (r"\bcompleted\b|\bcomplete\b|\bclosed\b|\bsolved\b", "Completed"),
        (r"\bproposed\b|\bproposal\b", "Proposed"),
        (r"\bhold\b|\bon hold\b", "Hold"),
        (r"\bwon\b", "Won"),
        (r"\bnew lead\b", "New Lead"),
        (r"\bpending\b", "Pending"),
        (r"\blost\b", "Lost"),
        (r"\bduplicate\b", "Duplicate"),
        (r"\bdeleted\b", "Deleted"),
    ]
    for pattern, status in status_aliases:
        if re.search(pattern, normalized):
            return status
    return None


def extract_customer_for_create(text: str) -> Optional[str]:
    patterns = [
        r"^new\s+lead\s+for\s+(.+?)(?:\s+contact\b|\s+(?:dubai|abu dhabi|sharjah|ajman|fujairah|rak|ras al khaimah|uaq|umm al quwain)\b|\s+(?:locator|migration|installation|service)\b|$)",
        r"\bcreate\s+(?:new\s+)?(?:service\s+)?(?:ticket|request)\s+for\s+(.+?)(?:\s+(?:migration|installation|locator|service)\b|$)",
        r"\bcreate\s+(?:new\s+)?(?:lead|customer)\s+for\s+(.+?)(?:\s+contact\b|\s+(?:dubai|abu dhabi|sharjah|ajman|fujairah|rak|ras al khaimah|uaq|umm al quwain)\b|\s+(?:locator|migration|installation|service)\b|$)",
    ]
    for pattern in patterns:
        match = re.search(pattern, normalize_text(text), flags=re.I)
        if match:
            value = match.group(1).strip(" .,:;?!")
            if value:
                return value
    return None


def detect_action_intent(text: str) -> Optional[Dict[str, Any]]:
    normalized = lower_text(text)
    if has_any(normalized, ["show", "list", "view", "find", "get", "search"]) and "new lead" in normalized and has_any(normalized, ["ticket", "tickets", "request", "requests", "lead", "leads", "record", "records", "job", "jobs", "task", "tasks"]):
        return None

    ticket_id = extract_ticket_id(text)
    staff_name = canonical_staff_name(text)
    region = canonical_region(text)
    status = extract_status(text)
    customer_name = extract_customer_for_create(text)

    if re.search(r"\breassign|re-assign\b", normalized):
        params: Dict[str, Any] = {}
        if ticket_id:
            params["ticketId"] = ticket_id
        from_match = re.search(r"\bfrom\s+([a-zA-Z ]+?)\s+to\s+([a-zA-Z ]+)\b", text, flags=re.I)
        to_match = re.search(r"\bto\s+([a-zA-Z ]+)\b", text, flags=re.I)
        if from_match:
            params["fromStaffName"] = from_match.group(1).strip()
            params["staffName"] = from_match.group(2).strip()
        elif to_match:
            params["staffName"] = to_match.group(1).strip()
        elif staff_name:
            params["staffName"] = staff_name
        return out("reassignTicket", params, 0.95)

    if re.search(r"\bassign\b", normalized):
        params = {}
        if ticket_id:
            params["ticketId"] = ticket_id
        if staff_name:
            params["staffName"] = staff_name
        return out("assignTicket", params, 0.94)

    if re.search(r"\b(delete|remove)\b", normalized) and re.search(r"\b(ticket|request|job)\b", normalized):
        return out("deleteTicket", {"ticketId": ticket_id} if ticket_id else {}, 0.95)

    if re.search(r"\bcancel\b", normalized) and re.search(r"\b(ticket|request|job)\b", normalized):
        return out("cancelTicket", {"ticketId": ticket_id} if ticket_id else {}, 0.95)

    if re.search(r"\b(update|mark|change)\b", normalized) and re.search(r"\b(ticket|request|job)\b", normalized):
        params = {}
        if ticket_id:
            params["ticketId"] = ticket_id
        if status:
            params["status"] = status
        return out("updateTicketStatus", params, 0.94)

    if re.search(r"\b(create|add|new)\b", normalized) and re.search(r"\bmigration\b|\bmigrate\b", normalized):
        params = {"serviceType": "migration"}
        if customer_name:
            params["customerName"] = customer_name
        if region:
            params["region"] = region
        return out("createMigrationTicket", params, 0.93)

    if re.search(r"\b(create|add|new)\b", normalized) and re.search(r"\binstallation\b|\binstall\b", normalized):
        params = {"serviceType": "installation"}
        if customer_name:
            params["customerName"] = customer_name
        if region:
            params["region"] = region
        return out("createInstallationTicket", params, 0.93)

    if re.search(r"^new\s+lead\b", normalized) or (re.search(r"\b(create|add|new)\b", normalized) and re.search(r"\b(lead|customer|registration)\b", normalized)):
        params = {}
        if customer_name:
            params["customerName"] = customer_name
        if region:
            params["region"] = region
        return out("createLead", params, 0.93)

    if re.search(r"\b(create|add|new)\b", normalized) and re.search(r"\b(service\s+)?(ticket|request)\b", normalized):
        params = {}
        if customer_name:
            params["customerName"] = customer_name
        if region:
            params["region"] = region
        return out("createServiceRequest", params, 0.92)

    return None


def trailing_value(text: str) -> Optional[str]:
    patterns = [
        r"\b(?:does|do|is|are)\s+(?:this\s+|the\s+)?(?:customer|account|company)\s+(?:exist|exists|available|registered|present)(?:\s+(?:in|on)\s+(?:our\s+)?(?:database|crm|system))?\s+(.+)$",
        r"\b(?:customer|account|company)\s+(.+?)\s+(?:exist|exists|available|registered|present)\b",
        r"\bwhere\s+is\s+(.+?)\s+located\b",
        r"\bwhich\s+region\s+is\s+(.+)$",
        r"\b(?:for|of|by|named|called|name|customer|account|company)\s+(.+)$",
        r"\b(?:phone|mobile|email)\s+(.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, normalize_text(text), flags=re.I)
        if match:
            value = match.group(1).strip(" .,:;?!")
            if value and value.lower() not in {"history", "region", "fleet", "size", "phone", "email"}:
                return value
    return None


def extract_customer_name(text: str) -> Optional[str]:
    patterns = [
        r"\bcustomer\s+history\s+(?:for|of)\s+(.+)$",
        r"\bhistory\s+(?:for|of)\s+(.+)$",
        r"\brecent\s+requests\s+(?:by|for|of)\s+(.+)$",
        r"\brecent\s+activity\s+(?:by|for|of)\s+(.+)$",
        r"\blast\s+(?:request|service)\s+(?:from|for|of)\s+(.+)$",
        r"\b(?:open\s+)?(?:tickets|jobs|requests)\s+(?:for|from|of)\s+(.+)$",
        r"\bcustomer\s+activity\s+(?:for|of)\s+(.+)$",
        r"\bany\s+issues\s+with\s+(.+)$",
        r"\bshow\s+contact\s+for\s+(.+)$",
        r"\b(?:customer\s+details|customer\s+profile|profile)\s+(?:for\s+)?(.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, normalize_text(text), flags=re.I)
        if match:
            return match.group(1).strip(" .,:;?!") or None
    return None


def extract_issue_value(text: str) -> Optional[str]:
    aliases = [
        (r"\b(no\s+connection|offline\s+devices?|offline|not\s+connecting)\b", "no connection"),
        (r"\bignition\s+issue\b|\bignition\b", "ignition"),
        (r"\bbattery\s+low\b|\bbattery\s+issues?\b", "battery"),
        (r"\btracker\s+not\s+working\b|\btracker\s+complaints?\b", "tracker not working"),
        (r"\bsim\s+replacement\b|\bsim\b", "sim"),
        (r"\breinstallation\b|\breinstall\b", "reinstallation"),
        (r"\binstallation\s+history\b|\binstallation\b", "installation"),
        (r"\brecurring\s+faults?\b|\bfaults?\b", "fault"),
    ]
    for pattern, value in aliases:
        if re.search(pattern, text, flags=re.I):
            return value
    match = re.search(r"\b(?:vehicle|device)\s+(?:history\s+for\s+|details\s+for\s+|with\s+)?(.+)$", text, flags=re.I)
    if match and re.search(r"\b(vehicle|device)\b", lower_text(text)):
        return re.sub(r"\b(details|history)\b$", "", match.group(1).strip(" .,:;?!"), flags=re.I).strip(" .,:;?!") or None
    return None


def has_any(normalized: str, words: List[str]) -> bool:
    return any(re.search(rf"\b{re.escape(word)}\b", normalized) for word in words)


def detect_intent(question: str) -> Dict[str, Any]:
    text = normalize_text(question)
    normalized = lower_text(text)

    if not text:
        return {"intent": "unknown", "params": {}, "confidence": 0.0}

    action_intent = detect_action_intent(text)
    if action_intent:
        return action_intent

    staff_name = canonical_staff_name(text)
    region = canonical_region(text)
    customer_name = extract_customer_name(text)
    email = extract_email(text)
    phone = extract_phone(text)
    ticket_id = extract_ticket_id(text)
    issue_value = extract_issue_value(text)
    date_range = extract_date_range(text)
    count_only = is_count_only_question(text)
    has_ticket = has_any(normalized, ["ticket", "tickets", "request", "requests", "lead", "leads", "record", "records", "job", "jobs", "task", "tasks", "queue"])
    has_open = has_any(normalized, ["pending", "open", "active", "ongoing", "unresolved", "hold", "new"])
    is_read_command = has_any(normalized, ["show", "list", "view", "find", "get", "search"])

    if has_ticket and "new lead" in normalized and is_read_command:
        return out("getTicketsByStatusLabel", {"statusLabel": "new lead", "limit": extract_limit(text, 50)}, 0.94)

    if "pending" in normalized and (
        "my pending" in normalized
        or re.search(r"\bpending\s+(list|items?|work|worklist)\b", normalized)
        or re.search(r"\b(list|show|view|get)\s+(my\s+)?pending\b", normalized)
    ):
        return out("getPendingTickets", {"limit": extract_limit(text, 50), "countOnly": count_only}, 0.93)

    if re.search(r"\bhow\s+many\b", normalized) and "pending" in normalized and has_ticket:
        return out("getPendingTickets", {"limit": extract_limit(text, 50), "countOnly": count_only}, 0.93)

    if "open" in normalized and re.search(r"\b(service\s+)?requests?\b", normalized) and "today" in normalized:
        return out("getOpenTickets", {"limit": extract_limit(text, 50), "countOnly": count_only}, 0.91)

    if re.search(r"\btoday'?s?\s+jobs?\b", normalized) and re.search(r"\b(all\s+)?technicians?\b", normalized):
        return out("getOpenTickets", {"limit": extract_limit(text, 50), "countOnly": count_only}, 0.91)

    if re.search(r"\b(most\s+common\s+(vehicle\s+)?issues?|common\s+issues?|trend\s+analysis|spot\s+check\s+patterns)\b", normalized):
        return out("getMostCommonIssues", {"limit": extract_limit(text, 20), "dateRange": date_range}, 0.92)

    if ticket_id and has_any(normalized, ["find", "show", "view", "get", "search"]):
        return out("getTicketById", {"ticketId": ticket_id}, 0.97)

    if has_any(normalized, ["migration", "migrations", "migrate"]) and (
        has_any(normalized, ["show", "list", "view", "get", "find", "recent", "latest", "history", "count", "total", "ticket", "tickets", "request", "requests", "job", "jobs", "task", "tasks", "there"])
        or re.search(r"\bhow\s+many\b", normalized)
    ):
        return out("getTicketsByServiceType", {"serviceType": "migration", "limit": extract_limit(text, 50), "dateRange": date_range, "countOnly": count_only}, 0.94)

    if has_any(normalized, ["unassigned"]) and has_any(normalized, ["ticket", "tickets", "job", "jobs", "request", "requests", "count", "queue"]):
        return out("getUnassignedTickets", {"limit": extract_limit(text, 50), "dateRange": date_range, "countOnly": count_only}, 0.94)

    if re.search(r"\b(who\s+is\s+free|free\s+today|available\s+technician|available\s+staff|least\s+workload|lowest\s+workload|overload|overloaded)\b", normalized):
        return out("getHighestWorkload" if re.search(r"\boverload|overloaded\b", normalized) else "getLowestWorkload", {"limit": 3}, 0.93)

    if re.search(r"\bperformance\s+report\s+for\s+technicians\b", normalized):
        return out("getStaffPerformance", {"limit": extract_limit(text, 25)}, 0.92)

    if re.search(r"\b(balance|rebalance|workload\s+analysis|technician\s+overload)\b", normalized):
        return out("getTechnicianWorkload", {"limit": extract_limit(text, 25)}, 0.92)

    if normalized in {"show", "list", "view"}:
        return out("getLatestRequests", {"limit": 10}, 0.82)

    if has_any(normalized, ["chat", "conversation", "message", "messages"]):
        if has_any(normalized, ["guest", "public"]):
            return out("getGuestChatHistory", {"limit": extract_limit(text, 25)}, 0.92)
        if has_any(normalized, ["staff", "technician"]) or staff_name:
            params: Dict[str, Any] = {"limit": extract_limit(text, 25)}
            if staff_name:
                params["channelName"] = f"staff:{staff_name}"
            return out("getStaffChatHistory", params, 0.92)

    if email and has_any(normalized, ["customer", "account", "company", "email"]):
        return out("findCustomerByEmail", {"value": email, "limit": extract_limit(text)}, 0.97)

    if phone and has_any(normalized, ["customer", "account", "company", "phone", "mobile", "number"]):
        return out("findCustomerByPhone", {"value": phone, "limit": extract_limit(text)}, 0.97)

    if issue_value and re.search(r"\b(search|show|which|history|requests?|issues?|complaints?|faults?|devices?|vehicles?|details|summary|common)\b", normalized):
        params: Dict[str, Any] = {"value": issue_value, "limit": extract_limit(text, 50), "dateRange": date_range, "countOnly": count_only}
        if region:
            params["region"] = region
        return out("getTicketsByIssue", params, 0.93)

    if has_any(normalized, ["fleet", "vehicles", "vehicle", "units"]):
        value = customer_name or trailing_value(text)
        if value:
            return out("getCustomerFleetSize", {"customerName": value, "limit": extract_limit(text)}, 0.94)

    if has_any(normalized, ["region", "emirate", "location", "located", "where"]) and (
        has_any(normalized, ["customer", "account", "company"]) or re.search(r"\bwhere\s+is\b", normalized) or re.search(r"\bwhich\s+region\s+is\b", normalized)
    ):
        value = customer_name or trailing_value(text)
        if value:
            return out("getCustomerRegion", {"customerName": value, "limit": extract_limit(text)}, 0.94)

    if staff_name and has_ticket and has_open:
        return out("getPendingTicketsByStaff", {"staffName": staff_name, "limit": extract_limit(text, 25), "countOnly": count_only}, 0.98)

    if staff_name and has_ticket:
        return out("getTicketsByStaff", {"staffName": staff_name, "limit": extract_limit(text, 25), "countOnly": count_only}, 0.93)

    if staff_name and re.search(r"\b(working\s+on|current\s+workload|workload|tasks?|jobs?|assigned|tickets?)\b", normalized):
        return out("getTicketsByStaff", {"staffName": staff_name, "limit": extract_limit(text, 25), "countOnly": count_only}, 0.94)

    if customer_name:
        if "show contact for" in normalized:
            return out("findCustomerByName", {"value": customer_name, "limit": extract_limit(text)}, 0.9)
        if re.search(r"\b(customer\s+details|customer\s+profile|profile)\b", normalized):
            return out("findCustomerByName", {"value": customer_name, "limit": extract_limit(text)}, 0.9)
        if re.search(r"\btoday'?s?\s+jobs?\b", normalized) and re.search(r"\b(all\s+)?technicians?\b", normalized):
            return out("getOpenTickets", {"limit": extract_limit(text, 50), "countOnly": count_only}, 0.91)
        if re.search(r"\b(most\s+common\s+(vehicle\s+)?issues?|common\s+issues?|trend\s+analysis|spot\s+check\s+patterns)\b", normalized):
            return out("getMostCommonIssues", {"limit": extract_limit(text, 20), "dateRange": date_range}, 0.92)
        if has_any(normalized, ["open", "active", "pending", "ongoing", "unresolved"]) and has_any(normalized, ["ticket", "tickets", "job", "jobs", "request", "requests"]):
            return out("getOpenTicketsByCustomer", {"customerName": customer_name, "limit": extract_limit(text, 50), "dateRange": date_range, "countOnly": count_only}, 0.95)
        if has_any(normalized, ["ticket", "tickets", "job", "jobs", "request", "requests", "service", "activity", "history", "issue", "issues"]):
            intent = "getCustomerHistory" if re.search(r"\b(history|activity|last|recent)\b", normalized) else "getTicketsByCustomer"
            return out(intent, {"customerName": customer_name, "limit": extract_limit(text, 50), "dateRange": date_range, "countOnly": count_only}, 0.94)
        return out("getCustomerHistory", {"customerName": customer_name, "limit": extract_limit(text, 25)}, 0.96)

    if has_any(normalized, ["customer", "account", "company"]) and has_any(normalized, ["find", "search", "show", "get", "view", "exist", "exists", "available", "registered", "present"]):
        value = trailing_value(text)
        if value:
            return out("findCustomerByName", {"value": value, "limit": extract_limit(text)}, 0.9)

    if has_any(normalized, ["search", "find"]) or "show contact for" in normalized:
        value = trailing_value(text) or re.sub(r"^\s*(search\s+for|search|find|show\s+contact\s+for)\s+", "", text, flags=re.I).strip(" .,:;?!")
        if 2 <= len(value) <= 160:
            return out("findCustomerByName", {"value": value, "limit": extract_limit(text)}, 0.89)

    if region and has_ticket and has_open:
        return out("getOpenTicketsByRegion", {"region": region, "limit": extract_limit(text), "dateRange": date_range, "countOnly": count_only, "latest": bool(re.search(r"\b(latest|recent|last)\b", normalized))}, 0.97)

    if region and has_ticket:
        return out("getTicketsByRegion", {"region": region, "limit": extract_limit(text), "dateRange": date_range, "countOnly": count_only, "latest": bool(re.search(r"\b(latest|recent|last)\b", normalized))}, 0.92)

    if has_any(normalized, ["highest", "busiest", "maximum"]) or "most loaded" in normalized or "most tickets" in normalized:
        return out("getHighestWorkload", {"limit": 1}, 0.93)

    if has_any(normalized, ["lowest", "minimum"]) or "least busy" in normalized or "least loaded" in normalized or "least tickets" in normalized:
        return out("getLowestWorkload", {"limit": 1}, 0.93)

    if has_any(normalized, ["staff", "technician", "team"]) and has_any(normalized, ["performance", "completed", "productivity"]):
        return out("getStaffPerformance", {"limit": extract_limit(text, 25)}, 0.92)

    if "workload" in normalized:
        return out("getTechnicianWorkload", {"limit": extract_limit(text, 25)}, 0.92)

    if has_any(normalized, ["duplicate", "duplicates", "repeated"]):
        return out("getDuplicateRequests", {"limit": extract_limit(text, 25)}, 0.92)

    if re.search(r"\b(need|needs|requiring|require|requires)\s+attention\b", normalized) or re.search(r"\battention\s+(ticket|tickets|request|requests|queue)\b", normalized):
        return out("getTicketsNeedingAttention", {"limit": extract_limit(text, 50), "countOnly": count_only}, 0.93)

    if re.search(r"\b(most\s+common\s+(vehicle\s+)?issues?|common\s+issues?|trend\s+analysis|spot\s+check\s+patterns)\b", normalized):
        return out("getMostCommonIssues", {"limit": extract_limit(text, 20), "dateRange": date_range}, 0.92)

    if re.search(r"\bcustomer\s+with\s+most\s+requests\b|\bhigh\s+priority\s+customers\b", normalized):
        return out("getCustomerWithMostRequests", {"limit": extract_limit(text, 20), "dateRange": date_range}, 0.92)

    if has_any(normalized, ["region", "regional", "emirate"]) and has_any(normalized, ["summary", "breakdown", "count", "workload"]):
        params: Dict[str, Any] = {"limit": extract_limit(text, 25), "dateRange": date_range}
        if region:
            params["region"] = region
        return out("getRegionSummary", params, 0.91)

    if "status" in normalized and has_any(normalized, ["summary", "breakdown", "count"]):
        return out("getStatusSummary", {"limit": extract_limit(text, 25), "dateRange": date_range}, 0.91)

    if has_any(normalized, ["daily", "today", "day"]) and has_any(normalized, ["summary", "snapshot", "operations", "report"]):
        return out("getDailySummary", {"limit": extract_limit(text, 7)}, 0.91)

    if has_any(normalized, ["monthly", "month"]) and has_any(normalized, ["summary", "snapshot", "operations", "report"]):
        return out("getMonthlySummary", {"limit": extract_limit(text, 12)}, 0.91)

    if "weekly summary" in normalized:
        return out("getDailySummary", {"limit": 7}, 0.91)

    if has_ticket and has_any(normalized, ["completed", "closed", "won", "solved"]) and "today" in normalized:
        return out("getCompletedTickets", {"limit": extract_limit(text, 50), "dateRange": "today", "countOnly": count_only}, 0.92)

    if has_ticket and has_any(normalized, ["completed", "closed", "won", "solved"]) and "week" in normalized:
        return out("getCompletedTicketsThisWeek", {"limit": extract_limit(text, 50), "dateRange": "this_week", "countOnly": count_only}, 0.94)

    if "full service queue" in normalized:
        return out("getOpenTickets", {"limit": extract_limit(text, 50)}, 0.91)

    if re.search(r"\b(alerts?|sla|risks?|recommended\s+actions)\b", normalized):
        return out("getTicketsNeedingAttention", {"limit": extract_limit(text, 50), "countOnly": count_only}, 0.91)

    if (
        "dashboard summary" in normalized
        or "operations summary" in normalized
        or "system snapshot" in normalized
        or normalized in {"summary", "snapshot"}
        or re.search(r"\b(full\s+overview|overall\s+fleet\s+status|operational\s+dashboard|service\s+statistics|queue\s+snapshot)\b", normalized)
        or (
            has_any(normalized, ["total", "count", "overall"])
            and has_any(normalized, ["record", "records", "ticket", "tickets", "request", "requests", "lead", "leads", "customer", "customers", "database", "crm", "system"])
        )
        or re.search(r"\bhow\s+many\b", normalized)
    ):
        return out("getDashboardSummary", {"dateRange": date_range}, 0.9)

    if has_ticket and has_any(normalized, ["completed", "closed", "won", "solved"]):
        return out("getCompletedTickets", {"limit": extract_limit(text), "dateRange": date_range, "countOnly": count_only}, 0.93)

    if "pending" in normalized and (has_ticket or re.search(r"\b(can\s+i\s+know|what|how\s+many|status|queue)\b", normalized)):
        return out("getPendingTickets", {"limit": extract_limit(text, 50), "dateRange": date_range, "countOnly": count_only}, 0.93)

    if has_open and (has_ticket or re.search(r"\b(can\s+i\s+know|what|how\s+many|status|queue)\b", normalized)):
        return out("getOpenTickets", {"limit": extract_limit(text, 50), "dateRange": date_range, "countOnly": count_only}, 0.91)

    if has_ticket and has_any(normalized, ["latest", "last", "recent"]):
        return out("getLatestRequests", {"limit": extract_limit(text)}, 0.94)

    return {"intent": "unknown", "params": {}, "confidence": 0.0}


def read_question(argv: List[str]) -> str:
    if len(argv) > 1:
        return " ".join(argv[1:])
    if not sys.stdin.isatty():
        return sys.stdin.read()
    return ""


def main() -> None:
    result = detect_intent(read_question(sys.argv))
    sys.stdout.write(json.dumps(result, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    main()

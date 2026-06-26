#!/usr/bin/env python3
"""
Safe SynoHub answer formatter.

Input must be JSON on stdin:
{"intent":"getLatestRequests","params":{},"rows":[...]}

Output is JSON only:
{"answer":"..."}

This script never generates SQL, executes SQL, connects to a database,
reads credentials, or invents records. It formats only supplied rows.
"""

import json
import sys
from typing import Any, Dict, List


def clean(value: Any, fallback: str = "") -> str:
    text = str(value if value is not None else fallback)
    return " ".join(text.split()).strip()


def as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def summarize_ticket(row: Dict[str, Any]) -> str:
    ticket_id = row.get("id", "")
    customer = clean(row.get("customerName"), "Unknown customer")
    status = clean(row.get("jobStatus") or row.get("status"), "Pending")
    location = clean(row.get("location") or row.get("region"))
    description = clean(row.get("issueDescription") or row.get("comment") or row.get("implementationType"), "No description")
    parts = [f"#{ticket_id}", customer, status]
    if location:
        parts.append(location)
    parts.append(description[:140])
    return " | ".join(parts)


def summarize_customer(row: Dict[str, Any]) -> str:
    name = clean(row.get("name") or row.get("customerName"), "Unknown customer")
    phone = clean(row.get("phone"), "No phone")
    email = clean(row.get("email"), "No email")
    region = clean(row.get("region"), "No region")
    fleet = as_int(row.get("vehicleCount"))
    return f"{name} | {phone} | {email} | {region} | Fleet: {fleet}"


def format_answer(intent: str, params: Dict[str, Any], rows: List[Dict[str, Any]]) -> str:
    count = len(rows)

    if intent in {"findCustomerByName", "findCustomerByPhone", "findCustomerByEmail"}:
        value = clean(params.get("value"), "the search")
        header = f"Found {count} customer{'s' if count != 1 else ''} matching {value}."
        return header if not rows else header + "\n\n" + "\n".join(summarize_customer(row) for row in rows[:10])

    if intent == "getCustomerHistory":
        name = clean(params.get("customerName"), "that customer")
        header = f"Found {count} record{'s' if count != 1 else ''} for {name}."
        return header if not rows else header + "\n\n" + "\n".join(summarize_ticket(row) for row in rows[:10])

    if intent == "getCustomerFleetSize":
        name = clean(params.get("customerName"), "that customer")
        header = f"Found {count} fleet-size result{'s' if count != 1 else ''} for {name}."
        if not rows:
            return header
        lines = [
            f"{clean(row.get('customerName'), 'Unknown customer')}: {as_int(row.get('vehicleCount'))} vehicles"
            for row in rows[:10]
        ]
        return header + "\n\n" + "\n".join(lines)

    if intent == "getCustomerRegion":
        name = clean(params.get("customerName"), "that customer")
        header = f"Found {count} region result{'s' if count != 1 else ''} for {name}."
        if not rows:
            return header
        lines = [
            f"{clean(row.get('customerName'), 'Unknown customer')}: {clean(row.get('region'), 'No region')}"
            for row in rows[:10]
        ]
        return header + "\n\n" + "\n".join(lines)

    if intent in {
        "getPendingTicketsByStaff",
        "getTicketsByStaff",
        "getOpenTicketsByRegion",
        "getTicketsByRegion",
        "getPendingTickets",
        "getOpenTickets",
        "getCompletedTickets",
        "getLatestRequests",
    }:
        label = {
            "getPendingTicketsByStaff": f"{clean(params.get('staffName'), 'Staff')} pending",
            "getTicketsByStaff": f"{clean(params.get('staffName'), 'Staff')} visible",
            "getOpenTicketsByRegion": f"{clean(params.get('region'), 'Region')} open",
            "getTicketsByRegion": f"{clean(params.get('region'), 'Region')} visible",
            "getPendingTickets": "pending",
            "getOpenTickets": "open",
            "getCompletedTickets": "completed",
            "getLatestRequests": "latest",
        }[intent]
        header = f"Found {count} {label} ticket{'s' if count != 1 else ''}."
        return header if not rows else header + "\n\n" + "\n".join(summarize_ticket(row) for row in rows[:10])

    if intent in {"getTechnicianWorkload", "getHighestWorkload", "getLowestWorkload"}:
        if not rows:
            return "No workload records found for your access level."
        lines = [
            f"{clean(row.get('staffName'), 'Unassigned')}: {as_int(row.get('openTickets'))} open / {as_int(row.get('totalTickets'))} total"
            for row in rows[:10]
        ]
        return "Technician workload summary:\n\n" + "\n".join(lines)

    if intent == "getStaffPerformance":
        if not rows:
            return "No staff performance records found for your access level."
        lines = [
            f"{clean(row.get('staffName'), 'Unassigned')}: {as_int(row.get('completedRecords'))} completed / {as_int(row.get('totalRecords'))} total"
            for row in rows[:10]
        ]
        return "Staff performance summary:\n\n" + "\n".join(lines)

    if intent == "getDuplicateRequests":
        if not rows:
            return "No duplicate requests found for your access level."
        lines = [
            f"{clean(row.get('customerName') or row.get('customerKey'), 'Unknown customer')}: {as_int(row.get('duplicateCount'))} duplicates"
            for row in rows[:10]
        ]
        return "Possible duplicate requests:\n\n" + "\n".join(lines)

    if intent == "getDashboardSummary":
        row = rows[0] if rows else {}
        return "\n".join([
            "Dashboard summary:",
            f"Total records: {as_int(row.get('totalRecords'))}",
            f"Open records: {as_int(row.get('openRecords'))}",
            f"New records: {as_int(row.get('newRecords'))}",
            f"Completed records: {as_int(row.get('completedRecords'))}",
            f"Total units: {as_int(row.get('totalUnits'))}",
            f"Unique customers: {as_int(row.get('uniqueCustomers'))}",
        ])

    if intent in {"getRegionSummary", "getStatusSummary", "getDailySummary", "getMonthlySummary"}:
        if not rows:
            return "No summary records found for your access level."
        label_key = {
            "getRegionSummary": "region",
            "getStatusSummary": "status",
            "getDailySummary": "day",
            "getMonthlySummary": "month",
        }[intent]
        lines = [
            f"{clean(row.get(label_key), 'Unknown')}: {as_int(row.get('totalRecords'))} records"
            for row in rows[:12]
        ]
        return "Summary:\n\n" + "\n".join(lines)

    if intent in {"getStaffChatHistory", "getGuestChatHistory"}:
        header = f"Found {count} chat message{'s' if count != 1 else ''}."
        if not rows:
            return header
        lines = [
            f"{clean(row.get('username'), 'unknown')} | {clean(row.get('role'), 'message')}: {clean(row.get('content'))[:140]}"
            for row in rows[:10]
        ]
        return header + "\n\n" + "\n".join(lines)

    return f"Found {count} result{'s' if count != 1 else ''}."


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        intent = clean(payload.get("intent"), "unknown")
        params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
        rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
        safe_rows = [row for row in rows if isinstance(row, dict)]
        answer = format_answer(intent, params, safe_rows)
        sys.stdout.write(json.dumps({"answer": answer}, ensure_ascii=True, separators=(",", ":")))
    except Exception:
        sys.stdout.write(json.dumps({"answer": "Unable to format the supplied query result."}, separators=(",", ":")))


if __name__ == "__main__":
    main()

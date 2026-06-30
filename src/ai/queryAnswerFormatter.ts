import type { AuthUser } from "../auth/users";
import { actionIntents, type SafeQueryIntent } from "./queryIntentDetector";
import { formatActionIntentAnswer } from "./queryResponseFormatter";
import {
  formatIssueSummary,
  formatOperationalAnswer,
  formatQueueReport,
  formatRegionTicketReport,
  formatServiceTypeReport,
  formatStaffWorkloadReport,
  formatStatusLabelReport,
  formatTicketListReport,
  formatTicketLookup,
  formatTopCustomers,
  humanDateRangeLabel,
  summarizeRow,
} from "./queryReportFormatter";

function cleanRecordDescription(value: unknown): string {
  return String(value || "No description")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeCustomer(row: any): string {
  const source = row.sourceType === "service_request" ? "service history" : "customer record";
  return `#${row.id} | ${row.name || row.customerName || "Unknown customer"} | ${row.phone || "No phone"} | ${row.email || "No email"} | ${row.region || "No region"} | Fleet: ${Number(row.vehicleCount || 0)} | ${source}`;
}

function cleanDuplicateCustomerLabel(value: unknown): string {
  return String(value || "Unknown customer")
    .replace(/\s+#\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatQueryAnswer(
  intent: SafeQueryIntent,
  params: Record<string, any>,
  rows: any[],
  queryUser?: Pick<AuthUser, "role" | "name">
): string {
  if (actionIntents.has(intent)) {
    return formatActionIntentAnswer(intent, params);
  }

  if (["findCustomerByName", "findCustomerByPhone", "findCustomerByEmail"].includes(intent)) {
    const count = rows.length;
    const label = intent === "findCustomerByPhone" ? "phone" : intent === "findCustomerByEmail" ? "email" : "name";
    const title = count === 0
      ? `No customer found matching ${label} search "${params.value}".`
      : `Yes, I found ${count} customer${count === 1 ? "" : "s"} matching ${label} search "${params.value}".`;
    return count === 0 ? title : `${title}\n\n${rows.slice(0, 10).map(summarizeCustomer).join("\n")}`;
  }

  if (intent === "getPendingTicketsByStaff") {
    return formatStaffWorkloadReport(params.staffName, rows, true, params);
  }

  if (intent === "getTicketsByStaff") {
    return formatStaffWorkloadReport(params.staffName, rows, false, params);
  }

  if (intent === "getOpenTicketsByRegion") {
    return formatRegionTicketReport(params.region, rows, { ...params, openOnly: true });
  }

  if (intent === "getTicketsByRegion") {
    return formatRegionTicketReport(params.region, rows, params);
  }

  if (intent === "getTicketsByServiceType") {
    return formatServiceTypeReport(params.serviceType, rows, params);
  }

  if (intent === "getTicketById") {
    return formatTicketLookup(params.ticketId, rows);
  }

  if (intent === "getTicketsByStatusLabel") {
    return formatStatusLabelReport(params.statusLabel, rows);
  }

  if (intent === "getCompletedTicketsThisWeek") {
    return formatQueueReport(rows, "completed tickets", { ...params, dateRange: "this_week" });
  }

  if (intent === "getTicketsNeedingAttention") {
    return formatTicketListReport("Tickets needing attention", rows, params);
  }

  if (intent === "getTicketsByCustomer") {
    return formatTicketListReport(`Tickets for ${params.customerName}`, rows, params);
  }

  if (intent === "getOpenTicketsByCustomer") {
    return formatTicketListReport(`Open tickets for ${params.customerName}`, rows, params);
  }

  if (intent === "getTicketsByIssue") {
    return formatTicketListReport(`Tickets matching "${params.value}"`, rows, params);
  }

  if (intent === "getUnassignedTickets") {
    return formatTicketListReport("Unassigned tickets", rows, params);
  }

  if (intent === "getMostCommonIssues") {
    return formatIssueSummary(rows, params.dateRange);
  }

  if (intent === "getCustomerWithMostRequests") {
    return formatTopCustomers(rows, params.dateRange);
  }

  if (intent === "getCustomerHistory") {
    const count = rows.length;
    return formatOperationalAnswer({
      title: `Customer history for ${params.customerName}`,
      direct: `Found ${count} visible record${count === 1 ? "" : "s"} for ${params.customerName}.`,
      details: rows.slice(0, 10).map(summarizeRow),
      suggestedActions: count > 0 ? [
        "- Review the latest IDs before creating a duplicate ticket.",
        "- Check open jobs for this customer if follow-up is needed.",
      ] : [
        "- Try a shorter customer name or alternate spelling.",
        "- Create a new lead if this is a brand-new customer.",
      ],
    });
  }

  if (intent === "getCustomerFleetSize") {
    const count = rows.length;
    const lines = rows.slice(0, 10).map(row => `${row.customerName}: ${Number(row.vehicleCount || 0)} vehicles${row.region ? ` | ${row.region}` : ""}`);
    return formatOperationalAnswer({
      title: `Fleet size for ${params.customerName}`,
      direct: `Found ${count} fleet-size result${count === 1 ? "" : "s"} for ${params.customerName}.`,
      details: lines,
    });
  }

  if (intent === "getCustomerRegion") {
    const count = rows.length;
    const lines = rows.slice(0, 10).map(row => `${row.customerName}: ${row.region || "No region"}${row.phone ? ` | ${row.phone}` : ""}`);
    return formatOperationalAnswer({
      title: `Customer region for ${params.customerName}`,
      direct: `Found ${count} region result${count === 1 ? "" : "s"} for ${params.customerName}.`,
      details: lines,
    });
  }

  if (["getPendingTickets", "getOpenTickets"].includes(intent)) {
    return formatQueueReport(rows, intent === "getPendingTickets" ? "pending service queue" : "open service queue", params);
  }

  if (["getCompletedTickets", "getLatestRequests"].includes(intent)) {
    const count = rows.length;
    const label = intent === "getCompletedTickets" ? "completed" : "latest";
    const totalMatches = Number(rows[0]?.totalMatches || rows.length);
    const guestScopeNote = queryUser?.role === "guest"
      ? "\nGuest access: only records created by this guest account are shown."
      : "";
    const title = intent === "getLatestRequests"
      ? `Showing latest ${count} visible ticket${count === 1 ? "" : "s"} out of ${totalMatches}${humanDateRangeLabel(params.dateRange)}.`
      : `Found ${totalMatches} ${label} ticket${totalMatches === 1 ? "" : "s"}${humanDateRangeLabel(params.dateRange)}.`;
    if (params.countOnly) return title;
    return count === 0
      ? `${title}${guestScopeNote}`
      : `${title}${guestScopeNote}\n\n${rows.slice(0, 10).map(summarizeRow).join("\n")}`;
  }

  if (intent === "getTechnicianWorkload") {
    if (rows.length === 0) return "No technician workload records found for your access level.";
    const lines = rows.slice(0, 10).map(row => `${row.staffName}: ${Number(row.openTickets || 0)} open / ${Number(row.totalTickets || 0)} total`);
    return formatOperationalAnswer({
      title: "Technician workload summary",
      direct: `Found workload data for ${rows.length} technician${rows.length === 1 ? "" : "s"}.`,
      details: lines,
      suggestedActions: [
        "- Assign new tickets to lower-load technicians where possible.",
        "- Review highest workload before adding urgent jobs.",
      ],
    });
  }

  if (intent === "getHighestWorkload") {
    if (rows.length === 0) return "No workload records found for your access level.";
    const row = rows[0];
    return formatOperationalAnswer({
      title: "Technician overload check",
      direct: `${row.staffName} has the highest visible workload with ${Number(row.openTickets || 0)} open tickets and ${Number(row.totalTickets || 0)} total records.`,
      suggestedActions: [
        "- Avoid assigning extra non-urgent jobs to this technician.",
        "- Check lowest workload for a possible reassignment option.",
      ],
    });
  }

  if (intent === "getLowestWorkload") {
    if (rows.length === 0) return "No workload records found for your access level.";
    const row = rows[0];
    const lines = rows.slice(0, 3).map(item => `${item.staffName}: ${Number(item.openTickets || 0)} open / ${Number(item.totalTickets || 0)} total`);
    return formatOperationalAnswer({
      title: "Available technician check",
      direct: `${row.staffName} currently has the lowest visible workload with ${Number(row.openTickets || 0)} open tickets.`,
      details: lines,
      suggestedActions: [
        "- Consider these technicians first for new low-priority assignments.",
        "- Confirm location before final dispatch.",
      ],
    });
  }

  if (intent === "getStaffPerformance") {
    if (rows.length === 0) return "No staff performance records found for your access level.";
    const lines = rows.slice(0, 10).map(row => `${row.staffName}: ${Number(row.completedRecords || 0)} completed / ${Number(row.totalRecords || 0)} total`);
    return formatOperationalAnswer({
      title: "Staff performance summary",
      direct: `Found performance data for ${rows.length} staff member${rows.length === 1 ? "" : "s"}.`,
      details: lines,
      suggestedActions: [
        "- Compare completion count with current workload before reassigning tickets.",
        "- Review pending jobs for high-volume staff.",
      ],
    });
  }

  if (intent === "getDuplicateRequests") {
    if (rows.length === 0) return "No duplicate requests found for your access level.";
    const lines = rows.slice(0, 10).map(row => `${cleanDuplicateCustomerLabel(row.customerName || row.customerKey)}: ${row.duplicateCount} duplicates, latest ID ${row.latestId}`);
    return formatOperationalAnswer({
      title: "Duplicate request detection",
      direct: `Found ${rows.length} possible duplicate customer/request group${rows.length === 1 ? "" : "s"}.`,
      details: lines,
      suggestedActions: [
        "- Check the latest ID before creating or assigning another ticket.",
        "- Merge or close accidental duplicates where policy allows.",
      ],
    });
  }

  if (intent === "getDashboardSummary") {
    const row = rows[0] || {};
    const totalRecords = Number(row.totalRecords || 0);
    const registeredCustomers = Number(row.registeredCustomers || row.uniqueCustomers || 0);
    const openRecords = Number(row.openRecords || 0);
    const newRecords = Number(row.newRecords || 0);
    const completedRecords = Number(row.completedRecords || 0);
    const totalUnits = Number(row.totalUnits || 0);
    const totalOperationalRecords = totalRecords + registeredCustomers;
    return formatOperationalAnswer({
      title: "SynoHub operational dashboard",
      direct: `The SynoHub CRM currently has ${totalOperationalRecords} visible operational records across registered customers and service/lead records.`,
      breakdown: [
        `- Registered Customers: ${registeredCustomers}`,
        `- Lead / Service Records: ${totalRecords}`,
        `- Open Records: ${openRecords}`,
        `- New Records: ${newRecords}`,
        `- Completed Records: ${completedRecords}`,
        `- Total Units: ${totalUnits}`,
      ],
      suggestedActions: [
        "- View pending service queue for dispatch priorities.",
        "- Check technician workload before assigning new tickets.",
        "- Review status summary for completed, open, and new records.",
      ],
    });
  }

  if (intent === "getRegionSummary") {
    if (rows.length === 0) return "No region summary records found for your access level.";
    const lines = rows.slice(0, 10).map(row => `${row.region}: ${Number(row.totalRecords || 0)} records, ${Number(row.openRecords || 0)} open, ${Number(row.totalUnits || 0)} units`);
    return formatOperationalAnswer({
      title: params.region ? `${params.region} region summary` : "Region summary",
      direct: `Found ${rows.length} region summar${rows.length === 1 ? "y" : "ies"} visible to you.`,
      details: lines,
      suggestedActions: [
        "- Review open counts before planning route-wise dispatch.",
        "- Use technician workload to balance region assignments.",
      ],
    });
  }

  if (intent === "getStatusSummary") {
    if (rows.length === 0) return "No status summary records found for your access level.";
    const lines = rows.slice(0, 10).map(row => `${row.status}: ${Number(row.totalRecords || 0)} records`);
    return formatOperationalAnswer({
      title: "Status summary",
      direct: `Found ${rows.length} status bucket${rows.length === 1 ? "" : "s"} visible to you.`,
      details: lines,
    });
  }

  if (intent === "getDailySummary") {
    if (rows.length === 0) return "No daily summary records found for your access level.";
    const lines = rows.slice(0, 10).map(row => `${row.day}: ${Number(row.totalRecords || 0)} total, ${Number(row.openRecords || 0)} open, ${Number(row.completedRecords || 0)} completed`);
    return formatOperationalAnswer({
      title: "Daily summary",
      direct: `Found ${rows.length} day${rows.length === 1 ? "" : "s"} of visible service activity.`,
      details: lines,
      suggestedActions: [
        "- Review days with high open counts first.",
        "- Use the pending queue for current dispatch planning.",
      ],
    });
  }

  if (intent === "getMonthlySummary") {
    if (rows.length === 0) return "No monthly summary records found for your access level.";
    const lines = rows.slice(0, 12).map(row => `${row.month}: ${Number(row.totalRecords || 0)} total, ${Number(row.openRecords || 0)} open, ${Number(row.completedRecords || 0)} completed`);
    return formatOperationalAnswer({
      title: "Monthly summary",
      direct: `Found ${rows.length} month${rows.length === 1 ? "" : "s"} of visible service activity.`,
      details: lines,
      suggestedActions: [
        "- Compare open counts month to month for queue pressure.",
        "- Review technician performance for completion trends.",
      ],
    });
  }

  if (["getStaffChatHistory", "getGuestChatHistory"].includes(intent)) {
    const count = rows.length;
    const title = `Found ${count} chat message${count === 1 ? "" : "s"}.`;
    const lines = rows.slice(0, 10).map(row => `${row.username} | ${row.role}: ${cleanRecordDescription(row.content).slice(0, 140)}`);
    return count === 0 ? title : `${title}\n\n${lines.join("\n")}`;
  }

  const count = rows.length;
  const title = `Found ${count} latest record${count === 1 ? "" : "s"}.`;
  return count === 0 ? title : `${title}\n\n${rows.slice(0, 10).map(summarizeRow).join("\n")}`;
}

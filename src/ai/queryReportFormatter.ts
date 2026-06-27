function cleanRecordDescription(value: unknown): string {
  return String(value || "No description")
    .replace(/\s+/g, " ")
    .trim();
}

export function summarizeRow(row: any): string {
  const status = row.jobStatus || row.status || "Pending";
  const description = cleanRecordDescription(row.issueDescription || row.comment || row.implementationType || "No description");
  const location = row.location || row.region || "";
  return `#${row.id} | ${row.customerName || "Unknown customer"} | ${status}${location ? ` | ${location}` : ""} | ${description}`;
}

export function getRowAssignee(row: any): string {
  return row.salesPerson || row.requestedPerson || "Unassigned";
}

export function getRowStatus(row: any): string {
  return String(row.jobStatus || row.status || "Pending").trim() || "Pending";
}

export function getLeadStatus(row: any): string {
  return String(row.status || row.jobStatus || "Pending").trim() || "Pending";
}

export function getRowDescription(row: any): string {
  return cleanRecordDescription(row.issueDescription || row.comment || row.implementationType || "No description");
}

export function formatQueueItem(row: any, duplicateAlert = false, statusMode: "job" | "lead" = "job"): string {
  const description = getRowDescription(row);
  const assignee = getRowAssignee(row);
  const location = row.location || row.region || "";
  const suffix = [
    `${statusMode === "lead" ? getLeadStatus(row) : getRowStatus(row)} | Assignee: ${assignee}`,
    location ? `Location: ${location}` : "",
  ].filter(Boolean).join(" | ");
  return `- ID ${row.id}: ${row.customerName || "Unknown customer"} - ${description} (${suffix})${duplicateAlert ? " [Duplicate Alert]" : ""}${assignee === "Unassigned" ? " [Needs Assignee]" : ""}`;
}

export function humanDateRangeLabel(dateRange?: string): string {
  if (dateRange === "today") return " for today";
  if (dateRange === "this_week") return " from the last 7 days";
  if (dateRange === "this_month") return " for this month";
  return "";
}

export function formatOperationalAnswer(parts: {
  title?: string;
  direct: string | string[];
  breakdown?: string[];
  details?: string[];
  suggestedActions?: string[];
}): string {
  const lines: string[] = [];
  if (parts.title) {
    lines.push(parts.title, "");
  }

  lines.push("Direct Answer:");
  lines.push(...(Array.isArray(parts.direct) ? parts.direct : [parts.direct]));

  if (parts.breakdown?.length) {
    lines.push("", "Breakdown:", ...parts.breakdown);
  }

  if (parts.details?.length) {
    lines.push("", "Details:", ...parts.details);
  }

  if (parts.suggestedActions?.length) {
    lines.push("", "Suggested Actions:", ...parts.suggestedActions);
  }

  return lines.join("\n").trim();
}

export function formatQueueReport(rows: any[], title = "active service queue", options: { countOnly?: boolean; dateRange?: string } = {}): string {
  const titleWithRange = `${title}${humanDateRangeLabel(options.dateRange)}`;
  if (rows.length === 0) {
    return formatOperationalAnswer({
      direct: `I do not see any visible records in the ${titleWithRange}.`,
      suggestedActions: [
        "- Check a broader date range or ask for the latest service queue.",
        "- Create a new service ticket if this is a fresh customer request.",
      ],
    });
  }

  const totalMatches = Number(rows[0]?.totalMatches || rows.length);
  if (options.countOnly) {
    return formatOperationalAnswer({
      direct: `There are ${totalMatches} visible ticket${totalMatches === 1 ? "" : "s"} in the ${titleWithRange}.`,
    });
  }
  const duplicateKeys = rows.reduce((counts: Record<string, number>, row: any) => {
    const key = `${String(row.customerName || "").toLowerCase()}|${getRowDescription(row).toLowerCase()}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

  const withDuplicateFlag = rows.map(row => {
    const key = `${String(row.customerName || "").toLowerCase()}|${getRowDescription(row).toLowerCase()}`;
    return { row, duplicateAlert: duplicateKeys[key] > 1 };
  });

  const isAttention = ({ row, duplicateAlert }: { row: any; duplicateAlert: boolean }) => {
    const description = getRowDescription(row).toLowerCase();
    return duplicateAlert
      || getRowAssignee(row) === "Unassigned"
      || /\b(no connection|not connecting|offline|ignition|tracker not working|battery low|missing)\b/.test(description);
  };
  const isNew = ({ row }: { row: any }) => getRowStatus(row).toLowerCase() === "new";

  const attention = withDuplicateFlag.filter(isAttention).slice(0, 12);
  const newRequests = withDuplicateFlag.filter(item => isNew(item) && !isAttention(item)).slice(0, 8);
  const active = withDuplicateFlag.filter(item => !isAttention(item) && !isNew(item)).slice(0, 24);
  const pendingCount = rows.filter(row => getRowStatus(row).toLowerCase() === "pending").length;
  const newCount = rows.filter(row => getRowStatus(row).toLowerCase() === "new").length;
  const unassignedCount = rows.filter(row => getRowAssignee(row) === "Unassigned").length;
  const duplicateCount = withDuplicateFlag.filter(item => item.duplicateAlert).length;

  const busiest = rows.reduce((counts: Record<string, number>, row: any) => {
    const assignee = getRowAssignee(row);
    if (assignee !== "Unassigned") counts[assignee] = (counts[assignee] || 0) + 1;
    return counts;
  }, {});
  const busiestStaff = (Object.entries(busiest) as Array<[string, number]>).sort((a, b) => b[1] - a[1])[0];

  const breakdown = [
    `- Requires Attention: ${attention.length} ticket${attention.length === 1 ? "" : "s"}`,
    `- Active Requests: ${active.length} ticket${active.length === 1 ? "" : "s"}`,
    `- New Requests: ${newCount} ticket${newCount === 1 ? "" : "s"}`,
    `- Duplicate Alerts: ${duplicateCount} ticket${duplicateCount === 1 ? "" : "s"}`,
  ];

  const details: string[] = [];
  if (attention.length > 0) {
    details.push("Requires Attention / Duplicate Alerts:", ...attention.map(item => formatQueueItem(item.row, item.duplicateAlert)));
  }

  if (newRequests.length > 0) {
    details.push("New Requests:", ...newRequests.map(item => formatQueueItem(item.row, item.duplicateAlert)));
  }

  if (active.length > 0) {
    details.push("Active Requests:", ...active.map(item => formatQueueItem(item.row, item.duplicateAlert)));
  }

  return formatOperationalAnswer({
    title: `SynoHub ${titleWithRange} overview`,
    direct: `There are ${totalMatches} visible ticket${totalMatches === 1 ? "" : "s"} in this result set. Showing latest ${rows.length}.`,
    breakdown,
    details,
    suggestedActions: [
      duplicateCount > 0 ? "- Review duplicate alerts and consolidate engineer schedules where appropriate." : "- Review high-priority connection and ignition issues first.",
      unassignedCount > 0 ? "- Assign technicians to unassigned tickets before dispatch planning." : "- Check technician workload before assigning the next service visit.",
      busiestStaff ? `- Rebalance workload if needed; ${busiestStaff[0]} currently appears most often in this result set.` : "- Use technician workload if you want a staff-wise assignment summary.",
    ],
  });
}

export function isSimpleGreetingMessage(text: string): boolean {
  return /^(h|hi|hello|hey|hai|hii|good\s+morning|good\s+afternoon|good\s+evening)\s*[!.?]*$/i.test(String(text || "").trim());
}

export function formatOperationalGreeting(userName: string, rows: any[]): string {
  const displayName = userName || "there";
  const closedStatuses = new Set(["completed", "won", "lost", "duplicate", "deleted", "cancelled", "canceled"]);
  const activeRows = rows.filter(row => {
    const status = String(row.jobStatus || row.status || "").trim().toLowerCase();
    return !closedStatuses.has(status);
  });

  const groups = activeRows.reduce((acc: Record<string, any[]>, row: any) => {
    const key = [
      String(row.customerName || "").trim().toLowerCase(),
      getRowDescription(row).trim().toLowerCase(),
      String(row.location || row.region || "").trim().toLowerCase(),
    ].join("|");
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  const duplicateGroup = (Object.values(groups) as any[][])
    .filter(group => group.length > 1)
    .sort((a, b) => Number(b[0]?.id || 0) - Number(a[0]?.id || 0))[0];

  const lines = [
    `Hello ${displayName}! Welcome to SynoHub. How can I help you with SynoHub fleet intelligence operations today?`,
  ];

  if (duplicateGroup?.length) {
    const sortedGroup = [...duplicateGroup].sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    const first = sortedGroup[0];
    const ids = sortedGroup.map(row => `ID ${row.id}`).join(" and ");
    const customer = first.customerName || "this customer";
    const issue = getRowDescription(first).toLowerCase();
    const location = first.location || first.region || "";
    const assignee = getRowAssignee(first);
    const assigneeText = assignee && assignee !== "Unassigned" ? ` Both are currently assigned to ${assignee}.` : "";
    lines.push(
      "",
      `I noticed duplicate pending tickets for ${customer} (${ids}) for the ${issue} service${location ? ` in ${location}` : ""}.${assigneeText}`
    );
  } else if (activeRows.length > 0) {
    const latest = activeRows[0];
    lines.push(
      "",
      `You currently have ${activeRows.length} visible active request${activeRows.length === 1 ? "" : "s"}. Latest: ID ${latest.id}, ${latest.customerName || "Unknown customer"} - ${getRowDescription(latest)}.`
    );
  }

  lines.push(
    "",
    "Would you like me to help you manage these requests, check your active workload, or register a new client?"
  );

  return lines.join("\n");
}

export function formatStaffWorkloadReport(staffName: string, rows: any[], pendingOnly = false, options: { countOnly?: boolean; dateRange?: string } = {}): string {
  if (rows.length === 0) {
    return formatOperationalAnswer({
      title: `${staffName.toUpperCase()} WORKLOAD SUMMARY`,
      direct: `${staffName} has no visible ${pendingOnly ? "pending " : ""}records for your access level.`,
      suggestedActions: [
        "- Check spelling of the staff name.",
        "- Review the full technician workload if you want another assignment option.",
      ],
    });
  }

  const activeStatuses = new Set(["pending", "new", "new lead", "hold", "ongoing"]);
  const activeRows = rows.filter(row => activeStatuses.has(getRowStatus(row).toLowerCase()));
  const totalMatches = Number(rows[0]?.totalMatches || rows.length);
  const openMatches = Number(rows[0]?.openMatches || activeRows.length);
  if (options.countOnly) {
    return `Direct Answer:\n${staffName} has ${openMatches} visible active job${openMatches === 1 ? "" : "s"}${humanDateRangeLabel(options.dateRange)}.`;
  }
  const newRows = rows.filter(row => getRowStatus(row).toLowerCase() === "new");
  const pendingRows = rows.filter(row => getRowStatus(row).toLowerCase() === "pending");
  const completedRows = rows.filter(row => ["completed", "won", "solved"].includes(getRowStatus(row).toLowerCase()));

  const formatCompact = (row: any) => {
    const location = row.location || row.region || "";
    return `- ${row.id} | ${row.customerName || "Unknown customer"} | ${getRowDescription(row)} | ${getRowStatus(row)}${location ? ` | ${location}` : ""}`;
  };
  const byDescription = (pattern: RegExp) => rows.filter(row => pattern.test(getRowDescription(row)));

  const sections = [
    `${staffName.toUpperCase()} WORKLOAD SUMMARY`,
    "",
    "Direct Answer:",
    `${staffName} has ${openMatches} active ticket${openMatches === 1 ? "" : "s"} out of ${totalMatches} visible record${totalMatches === 1 ? "" : "s"}${humanDateRangeLabel(options.dateRange)}.`,
    "",
    "Breakdown:",
    `Total Visible Records: ${totalMatches}`,
    `Total Active Tickets: ${openMatches}`,
    `Showing Latest: ${rows.length}`,
    "",
  ];

  if (newRows.length > 0) {
    sections.push("New Tickets:", newRows.slice(0, 8).map(formatCompact).join("\n"), "");
  }

  if (pendingRows.length > 0) {
    sections.push("Pending Tickets:", pendingRows.slice(0, 20).map(formatCompact).join("\n"), "");
  }

  const categories = [
    ["Migration Jobs", byDescription(/\bmigration|migrate\b/i)],
    ["Tracker Not Working / No Connection", byDescription(/\btracker not working|no connection|not connecting|offline|ignition\b/i)],
    ["Reinstallation Jobs", byDescription(/\bre-?installation|reinstall\b/i)],
    ["Device Removal Jobs", byDescription(/\bdevice removal|remove\b/i)],
  ] as Array<[string, any[]]>;

  for (const [label, matches] of categories) {
    sections.push(label + ":");
    sections.push(matches.length > 0 ? matches.slice(0, 10).map(formatCompact).join("\n") : "None");
    sections.push("");
  }

  if (completedRows.length > 0) {
    sections.push("Recent Completed:", completedRows.slice(0, 5).map(formatCompact).join("\n"), "");
  }

  sections.push(
    "Suggested Actions:",
    `- Review ${staffName}'s pending jobs before assigning new work.`,
    "- Check duplicate customer/service issues before dispatch.",
    "- Confirm location and vehicle plate details for field visits."
  );

  return sections.join("\n").trim();
}

export function formatServiceTypeReport(serviceType: string, rows: any[], options: { countOnly?: boolean; dateRange?: string } = {}): string {
  const label = serviceType === "migration" ? "migration" : serviceType;
  const titleLabel = label.charAt(0).toUpperCase() + label.slice(1);
  const rangeLabel = humanDateRangeLabel(options.dateRange);
  if (rows.length === 0) {
    return formatOperationalAnswer({
      title: `${titleLabel.toUpperCase()} JOB SUMMARY`,
      direct: `There are no visible active ${label} jobs${rangeLabel} for your access level.`,
      suggestedActions: [
        `- Search latest service requests if you expected ${label} records.`,
        "- Confirm the implementation type spelling in the source ticket.",
      ],
    });
  }

  const totalMatches = Number(rows[0]?.totalMatches || rows.length);
  if (options.countOnly) {
    return formatOperationalAnswer({
      title: `${titleLabel.toUpperCase()} JOB SUMMARY`,
      direct: `There ${totalMatches === 1 ? "is" : "are"} ${totalMatches} visible active ${label} job${totalMatches === 1 ? "" : "s"}${rangeLabel}.`,
    });
  }
  const pendingCount = rows.filter(row => getRowStatus(row).toLowerCase() === "pending").length;
  const newCount = rows.filter(row => getRowStatus(row).toLowerCase() === "new").length;
  const assigneeCounts = rows.reduce((counts: Record<string, number>, row: any) => {
    const assignee = getRowAssignee(row);
    counts[assignee] = (counts[assignee] || 0) + 1;
    return counts;
  }, {});
  const assigneeBreakdown = (Object.entries(assigneeCounts) as Array<[string, number]>)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([assignee, count]) => `${assignee}: ${count}`)
    .join(", ");
  const details = rows.slice(0, 20).map(row => formatQueueItem(row));

  return formatOperationalAnswer({
    title: `${titleLabel.toUpperCase()} JOB SUMMARY`,
    direct: `There ${totalMatches === 1 ? "is" : "are"} ${totalMatches} visible active ${label} job${totalMatches === 1 ? "" : "s"}${rangeLabel}.`,
    breakdown: [
      `- Showing latest: ${rows.length}`,
      `- Pending in shown records: ${pendingCount}`,
      `- New in shown records: ${newCount}`,
      `- By assignee: ${assigneeBreakdown || "No assignee data"}`,
    ],
    details,
    suggestedActions: [
      `- Confirm schedule and vehicle details for the ${label} queue.`,
      "- Check duplicate customer/service issues before dispatch.",
      "- Balance assignments if one technician has too many active jobs.",
    ],
  });
}

export function formatTicketLookup(ticketId: number, rows: any[]): string {
  if (rows.length === 0) {
    return `Ticket ID ${ticketId} was not found in records visible to your account.`;
  }
  const row = rows[0];
  return [
    `Ticket ID ${ticketId}`,
    "",
    `Customer: ${row.customerName || "Unknown customer"}`,
    `Status: ${getRowStatus(row)}`,
    `Assignee: ${getRowAssignee(row)}`,
    `Location: ${row.location || row.region || "No location"}`,
    `Description: ${getRowDescription(row)}`,
  ].join("\n");
}

export function formatStatusLabelReport(statusLabel: string, rows: any[]): string {
  const totalMatches = Number(rows[0]?.totalMatches || rows.length);
  const displayLabel = statusLabel.replace(/\b\w/g, char => char.toUpperCase());
  if (rows.length === 0) {
    return `No visible ${displayLabel} tickets were found.`;
  }
  return [
    `${displayLabel.toUpperCase()} TICKET SUMMARY`,
    "",
    `Direct Answer: There are ${totalMatches} visible ${displayLabel} ticket${totalMatches === 1 ? "" : "s"}. Showing latest ${rows.length}.`,
    "",
    "Details:",
    ...rows.slice(0, 20).map(row => formatQueueItem(row, false, "lead")),
  ].join("\n");
}

export function formatTicketListReport(title: string, rows: any[], options: { countOnly?: boolean; dateRange?: string; region?: string } = {}): string {
  const totalMatches = Number(rows[0]?.totalMatches || rows.length);
  const scopedTitle = `${title}${options.region ? ` in ${options.region}` : ""}${humanDateRangeLabel(options.dateRange)}`;
  if (rows.length === 0) {
    return formatOperationalAnswer({
      title: scopedTitle,
      direct: `No visible records found for ${scopedTitle}.`,
      suggestedActions: [
        "- Try a broader customer name, region, or issue keyword.",
        "- Check latest service requests if this is a recent ticket.",
      ],
    });
  }
  if (options.countOnly) {
    return formatOperationalAnswer({
      title: scopedTitle,
      direct: `Found ${totalMatches} visible record${totalMatches === 1 ? "" : "s"} for ${scopedTitle}.`,
    });
  }
  return formatOperationalAnswer({
    title: scopedTitle,
    direct: `Found ${totalMatches} visible record${totalMatches === 1 ? "" : "s"}. Showing latest ${rows.length}.`,
    details: rows.slice(0, 20).map(row => formatQueueItem(row)),
    suggestedActions: [
      "- Open the matching ticket IDs before dispatch or follow-up.",
      "- Check duplicate requests if the same customer appears multiple times.",
    ],
  });
}

export function formatRegionTicketReport(region: string, rows: any[], options: { countOnly?: boolean; dateRange?: string; openOnly?: boolean; latest?: boolean } = {}): string {
  const totalMatches = Number(rows[0]?.totalMatches || rows.length);
  const label = options.openOnly ? "open ticket" : "ticket";
  const rangeLabel = humanDateRangeLabel(options.dateRange);
  if (rows.length === 0) {
    return `No visible ${label}s found in ${region}${rangeLabel}.`;
  }
  const direct = options.latest
    ? `Showing latest ${rows.length} visible ${region} ${label}${rows.length === 1 ? "" : "s"} out of ${totalMatches}${rangeLabel}.`
    : `${region} has ${totalMatches} visible ${label}${totalMatches === 1 ? "" : "s"}${rangeLabel}.`;
  if (options.countOnly) {
    return formatOperationalAnswer({ title: `${region.toUpperCase()} SERVICE SUMMARY`, direct });
  }
  return formatOperationalAnswer({
    title: `${region.toUpperCase()} SERVICE SUMMARY`,
    direct,
    details: rows.slice(0, 10).map(summarizeRow),
    suggestedActions: [
      `- Review ${region} open tickets before scheduling field visits.`,
      "- Balance technician workload by location where possible.",
    ],
  });
}

export function formatIssueSummary(rows: any[], dateRange?: string): string {
  if (rows.length === 0) return formatOperationalAnswer({ direct: `No visible issue summary records found${humanDateRangeLabel(dateRange)}.` });
  const lines = rows.slice(0, 20).map(row => `${row.issue}: ${Number(row.totalRecords || 0)} total, ${Number(row.openRecords || 0)} open`);
  return formatOperationalAnswer({
    title: `Most common issues${humanDateRangeLabel(dateRange)}`,
    direct: `Found ${rows.length} issue pattern${rows.length === 1 ? "" : "s"} in visible records.`,
    details: lines,
    suggestedActions: [
      "- Prioritize high-volume open issue categories first.",
      "- Check repeated no-connection, ignition, and battery patterns before dispatch.",
    ],
  });
}

export function formatTopCustomers(rows: any[], dateRange?: string): string {
  if (rows.length === 0) return formatOperationalAnswer({ direct: `No visible customer request summary records found${humanDateRangeLabel(dateRange)}.` });
  const lines = rows.slice(0, 20).map(row => `${row.customerName}: ${Number(row.totalRecords || 0)} total, ${Number(row.openRecords || 0)} open`);
  return formatOperationalAnswer({
    title: `Customers with most requests${humanDateRangeLabel(dateRange)}`,
    direct: `Found ${rows.length} high-activity customer${rows.length === 1 ? "" : "s"} in visible records.`,
    details: lines,
    suggestedActions: [
      "- Review the top customers for repeated service patterns.",
      "- Check duplicate requests before creating a new follow-up ticket.",
    ],
  });
}

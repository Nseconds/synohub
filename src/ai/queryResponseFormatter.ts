export function formatActionIntentAnswer(intent: string, params: Record<string, any>): string {
  const labels: Record<string, string> = {
    assignTicket: "assign a ticket",
    reassignTicket: "reassign a ticket",
    updateTicketStatus: "update a ticket status",
    deleteTicket: "delete a ticket",
    cancelTicket: "cancel a ticket",
    createLead: "create a lead",
    createServiceRequest: "create a service request",
    createMigrationTicket: "create a migration ticket",
    createInstallationTicket: "create an installation ticket",
  };
  const details = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `- ${key}: ${value}`);

  return [
    `Detected action intent: ${intent}`,
    "",
    `Direct Answer: I classified this as a request to ${labels[intent] || "perform a ticket action"}.`,
    "",
    "Execution: No database changes were made. The /api/chat/query endpoint is read-only and records action intents for evaluation only.",
    ...(details.length ? ["", "Extracted Parameters:", ...details] : []),
    "",
    "Next Step: Use the authenticated chat workflow or admin UI action to execute this change with confirmation.",
  ].join("\n");
}

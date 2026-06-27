import { CustomerSchema } from "../shared/validation/customer";
import { LeadSchema } from "../shared/validation/lead";
import { ServiceRequestSchema } from "../shared/validation/serviceRequest";

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeLeadPayload(input: Record<string, any>) {
  return LeadSchema.parse(input);
}

export function normalizeServiceTicketPayload(input: Record<string, any>) {
  const parsed = ServiceRequestSchema.parse(input);
  return {
    customerName: parsed.customerName,
    description: parsed.description || parsed.issueDescription,
    status: parsed.status || parsed.jobStatus,
    quantity: parsed.quantity || parsed.newQty,
    requestedPerson: parsed.requestedPerson,
    payment: parsed.paymentStatus,
    amount: parsed.amount,
    assignee: parsed.assignee || parsed.salesPerson,
    location: parsed.location,
    region: parsed.region,
  };
}

export function normalizeCustomerPayload(input: Record<string, any>) {
  return CustomerSchema.parse(input);
}

import { z } from "zod";
import { optionalPositiveNumber, optionalString, stringFromAliases } from "./common";

export const ServiceRequestSchema = z.preprocess((raw) => {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    customerName: stringFromAliases(input, "customerName", "customer_name"),
    contactName: stringFromAliases(input, "contactName", "contact_name"),
    phone: stringFromAliases(input, "phone"),
    email: stringFromAliases(input, "email"),
    issueDescription: stringFromAliases(input, "issueDescription", "issue_description", "description"),
    description: stringFromAliases(input, "description", "issueDescription", "issue_description"),
    location: stringFromAliases(input, "location", "region"),
    region: stringFromAliases(input, "region", "location"),
    jobStatus: stringFromAliases(input, "jobStatus", "job_status", "status"),
    status: stringFromAliases(input, "status", "jobStatus", "job_status"),
    newQty: stringFromAliases(input, "newQty", "new_qty", "qty", "quantity"),
    quantity: stringFromAliases(input, "quantity", "newQty", "new_qty", "qty"),
    requestedPerson: stringFromAliases(input, "requestedPerson", "requested_person", "requestedBy", "requested_by", "requested", "assignee"),
    paymentStatus: stringFromAliases(input, "paymentStatus", "payment_status", "payment"),
    amount: stringFromAliases(input, "amount"),
    salesPerson: stringFromAliases(input, "salesPerson", "sales_person", "assignee", "requestedPerson", "requested_person", "requestedBy", "requested_by"),
    assignee: stringFromAliases(input, "assignee", "requestedPerson", "requested_person"),
    vehiclePlate: stringFromAliases(input, "vehiclePlate", "vehicle_plate"),
    accessories: stringFromAliases(input, "accessories"),
  };
}, z.object({
  customerName: optionalString,
  contactName: optionalString,
  phone: optionalString,
  email: optionalString,
  issueDescription: optionalString,
  description: optionalString,
  location: optionalString,
  region: optionalString,
  jobStatus: optionalString,
  status: optionalString,
  newQty: optionalPositiveNumber,
  quantity: optionalPositiveNumber,
  requestedPerson: optionalString,
  paymentStatus: optionalString,
  amount: optionalString,
  salesPerson: optionalString,
  assignee: optionalString,
  vehiclePlate: optionalString,
  accessories: optionalString,
}));

export type ServiceRequestInput = z.infer<typeof ServiceRequestSchema>;

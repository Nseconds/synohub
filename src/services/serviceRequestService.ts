import { eq, like } from "drizzle-orm";
import { db } from "../db";
import { customers, serviceRequests } from "../db/schema";
import type { AuthUser } from "../auth/users";
import { saveLocalSalesplusEntry } from "./salesplusService";

export interface ForcedServiceRequestFields {
  customerName: string;
  contactName: string;
  phone: string;
  email: string;
  driverNumber: string;
  implementationType: string;
  vehiclePlate: string;
  quantity: number;
  issueDescription: string;
  accessories: string;
  location: string;
  preferredDateTime: string;
  requestedPerson: string;
  amount: string;
  paymentStatus: string;
}

export interface ForcedServiceRequestResult {
  answer: string;
  customerMatched: boolean;
  customerCreated: boolean;
  customerId: number;
  serviceRequestId: number;
  salesplusSaved: boolean;
  fields: ForcedServiceRequestFields;
}

function normalizeComparablePhone(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

function isMissingTemplateValue(value: string): boolean {
  return !value || /^(n\/?a|na|none|null|-)?$/i.test(value.trim());
}

async function findExistingCustomerForServiceRequest(fields: ForcedServiceRequestFields): Promise<any | null> {
  const phone = fields.phone.trim();
  const email = fields.email.trim();
  const customerName = fields.customerName.trim();

  if (phone) {
    const exactPhone = await db.select().from(customers).where(eq(customers.phone, phone)).limit(1);
    if (exactPhone[0]) return exactPhone[0];

    const normalizedInputPhone = normalizeComparablePhone(phone);
    if (normalizedInputPhone) {
      const allCustomers = await db.select().from(customers);
      const normalizedMatch = allCustomers.find(customer => normalizeComparablePhone(customer.phone || "") === normalizedInputPhone);
      if (normalizedMatch) return normalizedMatch;
    }
  }

  if (email) {
    const exactEmail = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
    if (exactEmail[0]) return exactEmail[0];
  }

  if (customerName) {
    const exactName = await db.select().from(customers).where(eq(customers.name, customerName)).limit(1);
    if (exactName[0]) return exactName[0];

    const fuzzyName = await db.select().from(customers).where(like(customers.name, `%${customerName}%`)).limit(1);
    if (fuzzyName[0]) return fuzzyName[0];
  }

  return null;
}

function validateForcedServiceRequestFields(fields: ForcedServiceRequestFields) {
  const missing: string[] = [];
  if (isMissingTemplateValue(fields.customerName) || fields.customerName === "Unknown") missing.push("Customer Name");
  if (isMissingTemplateValue(fields.phone)) missing.push("Contact Number");
  if (isMissingTemplateValue(fields.implementationType)) missing.push("Implementation Type");
  if (isMissingTemplateValue(fields.issueDescription)) missing.push("Description");
  if (isMissingTemplateValue(fields.location)) missing.push("Service Location");
  if (missing.length > 0) {
    throw Object.assign(new Error(`Missing required service request fields: ${missing.join(", ")}.`), { statusCode: 400 });
  }
}

export async function saveForcedServiceRequestFields(
  parsed: ForcedServiceRequestFields,
  authUser: AuthUser,
  resolveRegionName: (text: string) => string | null,
): Promise<ForcedServiceRequestResult> {
  const fields: ForcedServiceRequestFields = { ...parsed };
  if (authUser.role === "staff" && authUser.name.trim()) {
    fields.requestedPerson = authUser.name.trim();
  }
  validateForcedServiceRequestFields(fields);

  const matchedCustomer = await findExistingCustomerForServiceRequest(fields);
  let customerId = matchedCustomer?.id ? Number(matchedCustomer.id) : 0;
  let customerCreated = false;
  const region = resolveRegionName(fields.location) || fields.location;

  if (!matchedCustomer) {
    const [customerResult]: any = await db.insert(customers).values({
      name: fields.customerName,
      contactName: fields.contactName,
      phone: fields.phone,
      email: fields.email,
      region,
      implementationType: fields.implementationType,
      vehicleCount: fields.quantity,
      createdBy: authUser.name.trim() || "guest",
    });
    customerId = Number(customerResult.insertId || 0);
    customerCreated = true;
  }

  const customerName = matchedCustomer?.name || fields.customerName;
  const salesType = matchedCustomer ? "Existing" : "New";
  const notes = [
    fields.preferredDateTime ? `Preferred Date/Time: ${fields.preferredDateTime}` : "",
    fields.driverNumber ? `Driver Number: ${fields.driverNumber}` : "",
  ].filter(Boolean).join("\n");

  const serviceInsert = {
    createdAt: new Date().toISOString().substring(0, 10),
    source: "WhatsApp",
    region,
    status: "New Lead",
    implementationType: fields.implementationType,
    customerName,
    contactName: fields.contactName,
    phone: fields.phone,
    email: fields.email,
    newQty: fields.quantity,
    accessories: fields.accessories,
    requestedPerson: fields.requestedPerson,
    salesPerson: fields.requestedPerson,
    salesType,
    comment: fields.issueDescription,
    issueDescription: fields.issueDescription,
    location: fields.location,
    paymentStatus: fields.paymentStatus,
    amount: fields.amount,
    projectValue: fields.amount,
    priceDetails: fields.amount,
    vehicleDetails: fields.vehiclePlate,
    notes,
    jobStatus: "Pending",
    createdBy: authUser.name.trim() || "guest",
  };

  const [serviceResult]: any = await db.insert(serviceRequests).values(serviceInsert);
  const serviceRequestId = Number(serviceResult.insertId || 0);

  let salesplusSaved = false;
  try {
    await saveLocalSalesplusEntry({
      ...serviceInsert,
      customerId,
      customer_id: customerId,
      customerName,
      newQty: fields.quantity,
      requestedPerson: fields.requestedPerson,
    }, serviceRequestId, fields.requestedPerson);
    salesplusSaved = true;
  } catch (salesplusErr) {
    console.error("Failed to save local Salesplus entry for forced service request:", salesplusErr);
  }

  const incompleteContactName = /^(mr|mrs|ms|miss|sir|madam)\.?$/i.test(fields.contactName.trim());
  const answer = [
    matchedCustomer
      ? "Existing customer found, so I linked the service request to that customer and saved it."
      : "No existing customer found, so I created a new customer and saved the service request.",
    "",
    `Request ID: ${serviceRequestId}`,
    `Customer: ${customerName}`,
    fields.contactName ? `Contact Person: ${fields.contactName}${incompleteContactName ? " (incomplete in request)" : ""}` : "",
    `Phone: ${fields.phone}`,
    fields.driverNumber ? `Driver Phone: ${fields.driverNumber}` : "",
    `Type: ${fields.implementationType}`,
    `Issue: ${fields.issueDescription}`,
    fields.vehiclePlate ? `Plate: ${fields.vehiclePlate}` : "",
    `Quantity: ${fields.quantity}`,
    `Location: ${fields.location}`,
    incompleteContactName ? "Note: The contact person field was saved as provided because the full name was missing from the request." : "",
  ].filter(Boolean).join("\n");

  return {
    answer,
    customerMatched: Boolean(matchedCustomer),
    customerCreated,
    customerId,
    serviceRequestId,
    salesplusSaved,
    fields: {
      ...fields,
      customerName,
    },
  };
}

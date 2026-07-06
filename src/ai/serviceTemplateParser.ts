import type { ForcedServiceRequestFields } from "../services/serviceRequestService";
import { normalizeLocationName } from "../utils/location";

export function extractTemplateField(input: string, labels: string[]): string {
  const templateFieldLabels = [
    "Customer Name", "Contact Person", "Contact Number", "Driver Number", "Driver Mobile", "Driver Phone",
    "Implementation Type", "Vehicle Plate", "Quantity", "Description", "accessories", "Service Location",
    "Preferred Date/Time", "Requested by", "Requested By", "Requested Person", "Amount",
    "Payment Status", "Payment", "Project Value", "Price", "Email", "E-mail", "Company Name",
    "Contact Name", "Phone", "Mobile", "Service Type", "Qty", "Plate", "Issue",
    "Location", "Region", "Accessories", "Preferred Date", "Date/Time"
  ];
  const sortedTemplateFieldLabels = [...templateFieldLabels].sort((a, b) => b.length - a.length);
  const inlineBreakLabels = sortedTemplateFieldLabels.filter(label => ![
    "Plate",
    "Location",
    "Preferred Date",
    "Date/Time",
  ].includes(label));
  let normalizedInput = String(input || "")
    .replace(/[•·]/g, "\n")
    .replace(/([*━]+)\s*([A-Za-z][A-Za-z /-]{1,40})\s*:/g, "\n$2:")
    .replace(/\s+(SERVICE REQUEST|CUSTOMER DETAILS|SERVICE REQUIREMENT|SERVICE DETAILS|PAYMENT DETAILS)\b/gi, "\n$1");
  for (const label of inlineBreakLabels) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    normalizedInput = normalizedInput.replace(new RegExp(`\\s+(${escapedLabel})\\s*:`, "gi"), "\n$1:");
  }
  for (const label of labels) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const linePattern = new RegExp(`^\\s*[*-]?\\s*${escapedLabel}\\s*:[^\\S\\r\\n]*([^\\r\\n]*)\\s*$`, "im");
    const lineMatch = normalizedInput.match(linePattern);
    if (lineMatch) {
      return lineMatch[1].replace(/[━*]+/g, " ").replace(/\s+/g, " ").trim();
    }
  }

  const escapedLabels = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const fieldLabels = sortedTemplateFieldLabels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const sectionLabels = [
    "PAYMENT DETAILS", "SERVICE REQUIREMENT", "SERVICE DETAILS", "CUSTOMER DETAILS", "SERVICE REQUEST"
  ].map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  const pattern = new RegExp(
    `(?:^|[\\s*━-])\\s*(?:${escapedLabels.join("|")})\\s*:\\s*([\\s\\S]*?)(?=(?:\\s+[\\s*━-]*(?:${fieldLabels.join("|")})\\s*:)|(?:\\s+[\\s*━-]*(?:${sectionLabels.join("|")})\\b)|$)`,
    "i"
  );
  const match = normalizedInput.match(pattern);
  return match?.[1]
    ? match[1].replace(/[━*]+/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

export function cleanTemplateValue(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[.,;]+$/, "")
    .trim();
}

export function cleanCustomerTemplateName(value: string): string {
  const parts = String(value || "").split("|").map(part => cleanTemplateValue(part)).filter(Boolean);
  const nonEmailParts = parts.filter(part => !extractEmail(part));
  const raw = nonEmailParts.length > 1
    ? nonEmailParts[nonEmailParts.length - 1]
    : (nonEmailParts[0] || parts[0] || value);
  let cleaned = cleanTemplateValue(raw)
    .replace(/\b(services?|requirement|payment|customer)\s+details\b/i, "")
    .trim();
  if (!/^details$/i.test(cleaned)) {
    cleaned = cleaned.replace(/\s+\bdetails\b$/i, "").trim();
  }
  if (/^al\s+ameen\s*sport$/i.test(cleaned.replace(/\s+/g, " "))) return "Al Ameen Sport";
  return cleaned;
}

export function cleanContactTemplateName(value: string): string {
  const parts = String(value || "").split("|").map(part => cleanTemplateValue(part)).filter(Boolean);
  return parts.length > 1 ? parts[0] : cleanTemplateValue(value);
}

function isMissingTemplateValue(value: string): boolean {
  return !value || /^(n\/?a|na|none|null|-)?$/i.test(value.trim());
}

export function parseServiceTemplateRecord(input: string): Record<string, any> | null {
  if (!/\bSERVICE REQUEST\b/i.test(input)) return null;

  const serviceType = canonicalizeImplementationType(extractTemplateField(input, ["Implementation Type"]));
  const customerName = cleanCustomerTemplateName(extractTemplateField(input, ["Customer Name"]));
  const contactName = cleanContactTemplateName(extractTemplateField(input, ["Contact Person", "Contact Name"]));
  const phone = cleanTemplateValue(extractTemplateField(input, ["Contact Number"]));
  const quantity = parseInt(cleanTemplateValue(extractTemplateField(input, ["Quantity"])) || "1", 10);
  const amountRaw = cleanTemplateValue(extractTemplateField(input, ["Amount"]));
  const amount = !amountRaw || /^n\/?a$/i.test(amountRaw) ? "0.00" : amountRaw;
  const location = cleanTemplateValue(extractTemplateField(input, ["Service Location", "Location"]));
  const requestedPerson = cleanTemplateValue(extractTemplateField(input, ["Requested by", "Requested By", "Requested Person"]));
  const rawDescription = cleanTemplateValue(extractTemplateField(input, ["Description"])) || "Service";
  const vehiclePlate = cleanTemplateValue(extractTemplateField(input, ["Vehicle Plate"]));
  const description = vehiclePlate && !isMissingTemplateValue(vehiclePlate)
    ? `${rawDescription} (Vehicle Plate: ${vehiclePlate})`
    : rawDescription;

  if (
    isMissingTemplateValue(serviceType) ||
    isMissingTemplateValue(customerName) ||
    isMissingTemplateValue(phone) ||
    isMissingTemplateValue(location) ||
    isMissingTemplateValue(requestedPerson)
  ) {
    return null;
  }

  return {
    type: "registration",
    customerName,
    contactName,
    phone,
    email: extractEmail(input) || "",
    region: location,
    implementationType: serviceType,
    status: "New Lead",
    salesType: "New",
    requestedPerson,
    comment: description,
    newQty: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    projectValue: amount,
    priceDetails: amount,
    paymentStatus: amount === "0.00" ? "Not Applicable" : "Pending",
    amount,
  };
}

export function formatServiceTemplateDraft(input: string): string | null {
  if (!/\bSERVICE REQUEST\b/i.test(input)) return null;

  const serviceType = canonicalizeImplementationType(extractTemplateField(input, ["Implementation Type"])) || "N/A";
  const customerName = cleanCustomerTemplateName(extractTemplateField(input, ["Customer Name"])) || "N/A";
  const contactName = cleanContactTemplateName(extractTemplateField(input, ["Contact Person", "Contact Name"])) || "N/A";
  const phone = cleanTemplateValue(extractTemplateField(input, ["Contact Number"])) || "N/A";
  const quantity = cleanTemplateValue(extractTemplateField(input, ["Quantity"])) || "1";
  const amountRaw = cleanTemplateValue(extractTemplateField(input, ["Amount"]));
  const amount = !amountRaw || /^n\/?a$/i.test(amountRaw) ? "0.00" : amountRaw;
  const payment = amount === "0.00" ? "Not Applicable" : "Pending";
  const location = cleanTemplateValue(extractTemplateField(input, ["Service Location", "Location"])) || "N/A";
  const requestedPerson = cleanTemplateValue(extractTemplateField(input, ["Requested by", "Requested By", "Requested Person"])) || "N/A";
  const rawDescription = cleanTemplateValue(extractTemplateField(input, ["Description"])) || "Service";
  const vehiclePlate = cleanTemplateValue(extractTemplateField(input, ["Vehicle Plate"]));
  const description = vehiclePlate && vehiclePlate !== "N/A"
    ? `${rawDescription} (Vehicle Plate: ${vehiclePlate})`
    : rawDescription;

  return [
    "Extracted service request details:",
    "",
    `Service Type       : ${serviceType}`,
    `Customer Name      : ${customerName}`,
    `Contact Name       : ${contactName}`,
    `Contact Number     : ${phone}`,
    `Quantity           : ${quantity}`,
    `Payment            : ${payment}`,
    `Amount             : ${amount}`,
    `Location           : ${location}`,
    `Requested Person   : ${requestedPerson}`,
    "Status             : New Lead",
    `Description        : ${description}`,
  ].join("\n");
}

function parseIntSafe(value: any, fallback = 0): number {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extractEmail(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].trim() : null;
}

function extractPhone(text: string): string | null {
  const match = text.match(/(?:\+?\d[\d\s().-]{5,}\d)/);
  if (!match) return null;
  const phone = match[0].replace(/[^\d+]/g, "");
  return phone.length >= 6 ? phone : null;
}

function canonicalizeLocation(value: string): string {
  return normalizeLocationName(cleanTemplateValue(value));
}

function canonicalizeImplementationType(value: string): string {
  const cleaned = cleanTemplateValue(value);
  const compact = cleaned.toUpperCase().replace(/\s*\+\s*/g, "+").replace(/\s+/g, " ").trim();
  const noSpace = compact.replace(/\s+/g, "");
  const knownTypes = [
    "LOCATOR",
    "ASATEEL",
    "LOCATOR+ASATEEL",
    "SECUREPATH",
    "LOCATOR+SECUREPATH",
    "RASID",
    "SERVICE",
    "SHAHIN",
    "SECUREPATH PREMIUM",
    "LOCATOR+SECUREPATH PREMIUM",
    "LOCATOR+RASID",
    "OTHER",
  ];
  return knownTypes.find(type => type.replace(/\s+/g, "") === noSpace) || compact || cleaned;
}

function isStrongServiceRequestText(input: string): boolean {
  const markers = [
    /\bSERVICE\s+REQUEST\b/i,
    /\bCUSTOMER\s+DETAILS\b/i,
    /\bSERVICE\s+REQUIREMENT\b/i,
    /\bPAYMENT\s+DETAILS\b/i,
    /\bImplementation\s+Type\s*:/i,
    /\bVehicle\s+Plate\s*:/i,
    /\bQuantity\s*:/i,
    /\bRequested\s+by\s*:/i,
    /\bRequested\s+Person\s*:/i,
    /\bService\s+Location\s*:/i,
    /\bContact\s+Number\s*:/i,
  ];
  if (!markers.some(marker => marker.test(input))) return false;

  const customerName = cleanCustomerTemplateName(extractTemplateField(input, ["Customer Name", "Company Name", "Customer"]));
  const phone = cleanTemplateValue(extractTemplateField(input, ["Contact Number", "Phone", "Mobile"])) || extractPhone(input) || "";
  return !isMissingTemplateValue(customerName) || !isMissingTemplateValue(phone);
}

export function parseForcedServiceRequest(input: string): ForcedServiceRequestFields | null {
  if (!isStrongServiceRequestText(input)) return null;

  const customerName = cleanCustomerTemplateName(extractTemplateField(input, ["Customer Name", "Company Name", "Customer"]));
  const phone = cleanTemplateValue(extractTemplateField(input, ["Contact Number", "Phone", "Mobile"])) || extractPhone(input) || "";
  if (isMissingTemplateValue(customerName) && isMissingTemplateValue(phone)) return null;

  const amountRaw = cleanTemplateValue(extractTemplateField(input, ["Amount", "Project Value", "Price"]));
  const amount = !amountRaw || /^n\/?a$/i.test(amountRaw) ? "0.00" : amountRaw;
  const paymentStatusRaw = cleanTemplateValue(extractTemplateField(input, ["Payment Status", "Payment"]));
  const implementationType = canonicalizeImplementationType(extractTemplateField(input, ["Implementation Type", "Service Type"])) || "SERVICE";
  const quantity = parseIntSafe(cleanTemplateValue(extractTemplateField(input, ["Quantity", "Qty"])), 1);
  const vehiclePlate = cleanTemplateValue(extractTemplateField(input, ["Vehicle Plate", "Plate"]));
  const issueDescription = cleanTemplateValue(extractTemplateField(input, ["Description", "Issue", "Service Requirement"])) || implementationType;
  const location = canonicalizeLocation(extractTemplateField(input, ["Service Location", "Location", "Region"]));

  return {
    customerName: customerName || "Unknown",
    contactName: cleanContactTemplateName(extractTemplateField(input, ["Contact Person", "Contact Name"])) || "",
    phone: cleanTemplateValue(phone),
    email: extractEmail(input) || cleanTemplateValue(extractTemplateField(input, ["Email", "E-mail"])) || "",
    driverNumber: cleanTemplateValue(extractTemplateField(input, ["Driver Number", "Driver Mobile", "Driver Phone"])) || "",
    implementationType,
    vehiclePlate,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    issueDescription,
    accessories: cleanTemplateValue(extractTemplateField(input, ["accessories", "Accessories"])) || "",
    location,
    preferredDateTime: cleanTemplateValue(extractTemplateField(input, ["Preferred Date/Time", "Preferred Date", "Date/Time"])) || "",
    requestedPerson: cleanTemplateValue(extractTemplateField(input, ["Requested by", "Requested By", "Requested Person"])) || "",
    amount,
    paymentStatus: paymentStatusRaw || (amount === "0.00" ? "Not Applicable" : "Pending"),
  };
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function firstDefined(input: Record<string, any>, keys: string[], fallback: any = undefined) {
  for (const key of keys) {
    if (input[key] !== undefined && input[key] !== null) return input[key];
  }
  return fallback;
}

function toInt(value: any, fallback = 0): number {
  const parsed = parseInt(value ?? fallback, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeLeadPayload(input: Record<string, any>) {
  return {
    customerName: firstDefined(input, ["customerName", "customer_name"]),
    contactName: firstDefined(input, ["contactName", "contact_name"]),
    phone: firstDefined(input, ["phone"]),
    email: firstDefined(input, ["email"]),
    region: firstDefined(input, ["region"]),
    address: firstDefined(input, ["address"]),
    mapLink: firstDefined(input, ["mapLink", "map_link"]),
    coordinates: firstDefined(input, ["coordinates"]),
    source: firstDefined(input, ["source"]),
    status: firstDefined(input, ["status"]),
    implementationType: firstDefined(input, ["implementationType", "implementation_type"]),
    salesPerson: firstDefined(input, ["salesPerson", "sales_person"]),
    salesType: firstDefined(input, ["salesType", "sales_type"]),
    requestedPerson: firstDefined(input, ["requestedPerson", "requested_person"]),
    comment: firstDefined(input, ["comment"]),
    projectValue: firstDefined(input, ["projectValue", "project_value"]),
    priceDetails: firstDefined(input, ["priceDetails", "price_details"]),
    accessories: firstDefined(input, ["accessories"]),
    newQty: toInt(firstDefined(input, ["newQty", "new_qty"], 0)),
    migrateQty: toInt(firstDefined(input, ["migrateQty", "migrate_qty"], 0)),
    tradingQty: toInt(firstDefined(input, ["tradingQty", "trading_qty"], 0)),
    serviceQty: toInt(firstDefined(input, ["serviceQty", "service_qty"], 0)),
    otherQty: toInt(firstDefined(input, ["otherQty", "other_qty"], 0)),
  };
}

export function normalizeServiceTicketPayload(input: Record<string, any>) {
  return {
    customerName: firstDefined(input, ["customerName", "customer_name"]),
    description: firstDefined(input, ["description", "issueDescription", "issue_description"]),
    status: firstDefined(input, ["status"]),
    quantity: toInt(firstDefined(input, ["quantity", "newQty", "new_qty"], 1), 1),
    requestedPerson: firstDefined(input, ["requestedPerson", "requested_person"]),
    payment: firstDefined(input, ["payment", "paymentStatus", "payment_status"]),
    amount: firstDefined(input, ["amount"]),
    assignee: firstDefined(input, ["assignee", "salesPerson", "sales_person"]),
    location: firstDefined(input, ["location", "region"]),
    region: firstDefined(input, ["region", "location"]),
  };
}

export function normalizeCustomerPayload(input: Record<string, any>) {
  return {
    name: firstDefined(input, ["name", "customerName", "customer_name"]),
    contactName: firstDefined(input, ["contactName", "contact_name"]),
    phone: firstDefined(input, ["phone"]),
    email: firstDefined(input, ["email"]),
    region: firstDefined(input, ["region"]),
    implementationType: firstDefined(input, ["implementationType", "implementation_type"]),
    vehicleCount: toInt(firstDefined(input, ["vehicleCount", "vehicle_count"], 0)),
  };
}

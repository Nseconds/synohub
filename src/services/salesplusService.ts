import { db } from "../db";
import { salesplusEntries } from "../db/schema";

export function parseIntSafe(value: any, fallback = 0): number {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSalesplusStatus(status: any): string {
  const raw = String(status || "New").trim();
  if (!raw || raw.toLowerCase() === "new lead") return "New";
  return raw;
}

function lookupSalesplusStaffId(name: any): string {
  const staffName = String(name || "").trim();
  if (!staffName) return "0";
  try {
    const configured = process.env.SALESPLUS_STAFF_IDS ? JSON.parse(process.env.SALESPLUS_STAFF_IDS) : {};
    const match = Object.entries(configured).find(([key]) => key.toLowerCase() === staffName.toLowerCase());
    if (match) return String(match[1]);
  } catch {
    console.warn("SALESPLUS_STAFF_IDS must be valid JSON, for example {\"Athul\":\"5\"}.");
  }
  return "0";
}

export function buildSalesplusEntry(input: any, synohubRequestId: number, requestedPerson: string) {
  const status = normalizeSalesplusStatus(input.status || input.sales_plus_status);
  const implementationType = input.implementationType || input.implementation_type || input.sales_plus_implementation_type || "";
  const salesType = input.salesType || input.sales_type || input.sales_plus_type || "New";
  const companyName = input.customerName || input.customer_name || input.sales_plus_company_name || "";
  const contactName = input.contactName || input.contact_name || input.sales_plus_customer_name || companyName;
  const comment = input.comment || input.sales_plus_comment || "";
  const phone = input.phone || input.sales_plus_phone || "";
  const staffId = lookupSalesplusStaffId(requestedPerson || input.requestedPerson || input.requested_person);
  const isWon = status.toLowerCase() === "won";
  const isExisting = salesType.toLowerCase() === "existing";

  return {
    synohubRequestId,
    salesPlusId: parseIntSafe(input.sales_plus_id, 0),
    salesPlusDate: input.sales_plus_date || input.createdAt || new Date().toISOString().substring(0, 10),
    salesPlusSource: input.source || input.sales_plus_source || "Company Lead",
    salesPlusRegion: input.region || input.sales_plus_region || "",
    salesPlusStatus: status,
    salesPlusImplementationType: implementationType,
    locatorPlan: input.locatorPlan || input.locator_plan || "",
    salesPlusPrice: input.priceDetails || input.price_details || input.sales_plus_price || "",
    salesPlusProjectValue: input.projectValue || input.project_value || input.sales_plus_project_value || "",
    salesPlusCompanyName: companyName,
    salesPlusCustomerName: contactName,
    salesPlusPhone: phone,
    salesPlusEmail: input.email || input.sales_plus_email || "",
    salesPlusDesignation: input.designation || input.sales_plus_designation || "",
    salesPlusAddress: input.address || input.sales_plus_address || "",
    salesPlusAddressMap: input.mapLink || input.map_link || input.sales_plus_address_map || "",
    salesPlusAddressCoordinates: input.coordinates || input.sales_plus_address_coordinates || "",
    salesPlusPerson: staffId,
    salesPlusType: salesType,
    salesPlusQuantityNew: parseIntSafe(input.newQty || input.new_qty || input.sales_plus_quantity_new, 0),
    salesPlusQuantityMigrate: parseIntSafe(input.migrateQty || input.migrate_qty || input.sales_plus_quantity_migrate, 0),
    salesPlusQuantityTrading: parseIntSafe(input.tradingQty || input.trading_qty || input.sales_plus_quantity_trading, 0),
    salesPlusQuantityService: parseIntSafe(input.serviceQty || input.service_qty || input.sales_plus_quantity_service, 0),
    salesPlusQuantityOthers: parseIntSafe(input.otherQty || input.other_qty || input.sales_plus_quantity_others, 0),
    salesPlusSupplier: input.supplier || input.sales_plus_supplier || "",
    salesPlusAccessories: input.accessories || input.sales_plus_accessories || "",
    salesPlusComment: comment,
    salesPlusRequestedBy: staffId,
    scheduleNote: input.schedule_note || comment,
    schedulePhone: input.schedule_phone || phone,
    priority: input.priority || "normal",
    clientName: input.clientName || companyName,
    itcUsername: input.itcUsername || "",
    itcPassword: input.itcPassword || "",
    projectImplementationType: input.projectImplementationType || implementationType,
    leadType: input.leadType || salesType,
    tradeNumber: input.tradeNumber || "",
    notes: input.notes || comment,
    createNewNob: isWon ? 1 : 0,
    existingCustomer: isExisting ? 1 : 0,
    customerId: parseIntSafe(input.customer_id || input.customerId, 0),
    additionalContactDetails: input.additional_contact_details || input.additionalContactDetails || "[]",
    synohubRequestedPerson: requestedPerson || "",
  };
}

export async function saveLocalSalesplusEntry(input: any, synohubRequestId: number, requestedPerson: string) {
  const entry = buildSalesplusEntry(input, synohubRequestId, requestedPerson);
  await db.insert(salesplusEntries).values(entry);
  console.log(`[Salesplus Local] Saved mapped entry for SynoHub request #${synohubRequestId}.`);
}

import { z } from "zod";
import { optionalNumber, optionalString, stringFromAliases } from "./common";

export const LeadSchema = z.preprocess((raw) => {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    source: stringFromAliases(input, "source"),
    region: stringFromAliases(input, "region"),
    status: stringFromAliases(input, "status"),
    implementationType: stringFromAliases(input, "implementationType", "implementation_type"),
    customerName: stringFromAliases(input, "customerName", "customer_name"),
    contactName: stringFromAliases(input, "contactName", "contact_name"),
    designation: stringFromAliases(input, "designation"),
    phone: stringFromAliases(input, "phone"),
    email: stringFromAliases(input, "email"),
    address: stringFromAliases(input, "address"),
    mapLink: stringFromAliases(input, "mapLink", "map_link"),
    coordinates: stringFromAliases(input, "coordinates"),
    newQty: stringFromAliases(input, "newQty", "new_qty", "qty", "quantity"),
    migrateQty: stringFromAliases(input, "migrateQty", "migrate_qty"),
    tradingQty: stringFromAliases(input, "tradingQty", "trading_qty"),
    serviceQty: stringFromAliases(input, "serviceQty", "service_qty"),
    otherQty: stringFromAliases(input, "otherQty", "other_qty"),
    accessories: stringFromAliases(input, "accessories"),
    requestedPerson: stringFromAliases(input, "requestedPerson", "requested_person"),
    salesPerson: stringFromAliases(input, "salesPerson", "sales_person"),
    salesType: stringFromAliases(input, "salesType", "sales_type"),
    projectValue: stringFromAliases(input, "projectValue", "project_value"),
    priceDetails: stringFromAliases(input, "priceDetails", "price_details"),
    comment: stringFromAliases(input, "comment"),
  };
}, z.object({
  source: optionalString,
  region: optionalString,
  status: optionalString,
  implementationType: optionalString,
  customerName: optionalString,
  contactName: optionalString,
  designation: optionalString,
  phone: optionalString,
  email: optionalString,
  address: optionalString,
  mapLink: optionalString,
  coordinates: optionalString,
  newQty: optionalNumber,
  migrateQty: optionalNumber,
  tradingQty: optionalNumber,
  serviceQty: optionalNumber,
  otherQty: optionalNumber,
  accessories: optionalString,
  requestedPerson: optionalString,
  salesPerson: optionalString,
  salesType: optionalString,
  projectValue: optionalString,
  priceDetails: optionalString,
  comment: optionalString,
}));

export type LeadInput = z.infer<typeof LeadSchema>;

import { z } from "zod";
import { optionalNumber, optionalString, stringFromAliases } from "./common";

export const CustomerSchema = z.preprocess((raw) => {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    name: stringFromAliases(input, "name", "customerName", "customer_name"),
    contactName: stringFromAliases(input, "contactName", "contact_name"),
    phone: stringFromAliases(input, "phone"),
    email: stringFromAliases(input, "email"),
    region: stringFromAliases(input, "region"),
    implementationType: stringFromAliases(input, "implementationType", "implementation_type"),
    vehicleCount: stringFromAliases(input, "vehicleCount", "vehicle_count"),
  };
}, z.object({
  name: optionalString,
  contactName: optionalString,
  phone: optionalString,
  email: optionalString,
  region: optionalString,
  implementationType: optionalString,
  vehicleCount: optionalNumber,
}));

export type CustomerInput = z.infer<typeof CustomerSchema>;

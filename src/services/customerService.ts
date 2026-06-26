import { eq } from "drizzle-orm";
import { db } from "../db";
import { customers } from "../db/schema";

export type CustomerSyncResult =
  | { action: "skipped"; customerName: string }
  | { action: "created"; customerName: string; vehicleCount: number }
  | { action: "updated"; customerName: string; vehicleCount: number };

export async function syncRegistrationCustomer(input: any, userName: string, defaultQuantity = 0): Promise<CustomerSyncResult> {
  const customerName = input.customerName || input.customer_name || "Unknown";
  if (!customerName || customerName === "Unknown") {
    return { action: "skipped", customerName };
  }

  const existing = await db.select().from(customers).where(eq(customers.name, customerName));
  const totalQty = defaultQuantity > 0
    ? parseInt(input.newQty || input.new_qty || defaultQuantity)
    : parseInt(input.newQty || input.new_qty || 0) +
      parseInt(input.migrateQty || input.migrate_qty || 0) +
      parseInt(input.tradingQty || input.trading_qty || 0) +
      parseInt(input.serviceQty || input.service_qty || 0) +
      parseInt(input.otherQty || input.other_qty || 0);

  if (existing.length === 0) {
    const vehicleCount = defaultQuantity > 0 ? totalQty : (totalQty > 0 ? totalQty : 1);
    await db.insert(customers).values({
      name: customerName,
      contactName: input.contactName || input.contact_name || "",
      phone: input.phone || "",
      email: input.email || "",
      region: input.region || "",
      implementationType: input.implementationType || input.implementation_type || "",
      vehicleCount,
      createdBy: userName || "guest",
    });
    return { action: "created", customerName, vehicleCount };
  }

  const currentCount = existing[0].vehicleCount || 0;
  const vehicleCount = currentCount + totalQty;
  await db.update(customers)
    .set({ vehicleCount })
    .where(eq(customers.name, customerName));
  return { action: "updated", customerName, vehicleCount };
}

export async function syncLeadEditCustomer(input: any): Promise<CustomerSyncResult> {
  const customerName = input.customerName || input.customer_name;
  if (!customerName || customerName === "Unknown") {
    return { action: "skipped", customerName };
  }

  const existing = await db.select().from(customers).where(eq(customers.name, customerName));
  const totalQty = parseInt(input.newQty || input.new_qty || 0) +
    parseInt(input.migrateQty || input.migrate_qty || 0) +
    parseInt(input.tradingQty || input.trading_qty || 0) +
    parseInt(input.serviceQty || input.service_qty || 0) +
    parseInt(input.otherQty || input.other_qty || 0);

  if (existing.length === 0) {
    const vehicleCount = totalQty > 0 ? totalQty : 1;
    await db.insert(customers).values({
      name: customerName,
      contactName: input.contactName || input.contact_name || "",
      phone: input.phone || "",
      email: input.email || "",
      region: input.region || "",
      implementationType: input.implementationType || input.implementation_type || "",
      vehicleCount,
    });
    return { action: "created", customerName, vehicleCount };
  }

  const vehicleCount = totalQty > 0 ? totalQty : existing[0].vehicleCount;
  await db.update(customers)
    .set({
      contactName: input.contactName || input.contact_name || existing[0].contactName,
      phone: input.phone || existing[0].phone,
      email: input.email || existing[0].email,
      region: input.region || existing[0].region,
      implementationType: input.implementationType || input.implementation_type || existing[0].implementationType,
      vehicleCount,
    })
    .where(eq(customers.name, customerName));
  return { action: "updated", customerName, vehicleCount };
}

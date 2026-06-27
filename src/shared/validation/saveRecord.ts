import { z } from "zod";
import { CustomerSchema } from "./customer";
import { LeadSchema } from "./lead";
import { ServiceRequestSchema } from "./serviceRequest";

export const SaveRecordSchema = z.preprocess((raw) => {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const type = input.type;
  if (type === "registration") return { type, ...LeadSchema.parse(input) };
  if (type === "service") return { type, ticketId: input.ticketId, ...ServiceRequestSchema.parse(input) };
  if (type === "customer") return { type, ...CustomerSchema.parse(input) };
  return input;
}, z.discriminatedUnion("type", [
  z.object({ type: z.literal("registration") }).passthrough(),
  z.object({ type: z.literal("service"), ticketId: z.unknown().optional() }).passthrough(),
  z.object({ type: z.literal("customer") }).passthrough(),
]));

export type SaveRecordInput = z.infer<typeof SaveRecordSchema>;

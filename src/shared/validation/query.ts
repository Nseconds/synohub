import { z } from "zod";

const numberFromQuery = (defaultValue: number) => z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  const parsed = Number.parseInt(Array.isArray(value) ? String(value[0]) : String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}, z.number());

const stringFromQuery = z.preprocess((value) => {
  if (Array.isArray(value)) return value[0] || "";
  return value === undefined || value === null ? "" : String(value);
}, z.string());

export const QuerySchema = z.preprocess((raw) => {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    ...input,
    search: input.search ?? input.q,
  };
}, z.object({
  page: numberFromQuery(1),
  limit: numberFromQuery(50),
  status: stringFromQuery.optional().default(""),
  region: stringFromQuery.optional().default(""),
  search: stringFromQuery.optional().default(""),
  role: stringFromQuery.optional().default(""),
}).passthrough());

export type QueryInput = z.infer<typeof QuerySchema>;

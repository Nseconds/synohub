import { z } from "zod";

export const emptyToUndefined = (value: unknown) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

export const optionalString = z.preprocess(
  emptyToUndefined,
  z.string().optional()
);

export const optionalNumber = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}, z.number().optional().default(0));

export const optionalPositiveNumber = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) return 1;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}, z.number().optional().default(1));

export const stringFromAliases = (input: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = input[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

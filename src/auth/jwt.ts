import crypto from "crypto";
import env from "../shared/validation/env";
import type { AuthUser } from "./users";

function cleanEnvVar(val: string | undefined): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

const authSecret = cleanEnvVar(env.AUTH_SECRET || env.JWT_SECRET) || crypto.randomBytes(32).toString("hex");

if (!env.AUTH_SECRET && !env.JWT_SECRET) {
  console.warn("AUTH_SECRET is not set. Tokens will be invalidated on every server restart.");
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payload: string): string {
  return crypto.createHmac("sha256", authSecret).update(payload).digest("base64url");
}

export function issueToken(user: Pick<AuthUser, "sub" | "name" | "role">): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthUser = {
    ...user,
    iat: now,
    exp: now + 60 * 60 * 12,
  };
  const encodedPayload = base64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function verifyToken(token: string | undefined): AuthUser | null {
  if (!token || !token.includes(".")) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signPayload(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as AuthUser;
    if (!parsed.name || !parsed.role || !parsed.sub || !parsed.exp) return null;
    if (!["admin", "staff", "guest"].includes(parsed.role)) return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

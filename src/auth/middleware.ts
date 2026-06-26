import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "./jwt";
import type { AuthUser, UserRole } from "./users";

export function getBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = verifyToken(getBearerToken(req));
  if (!user) {
    return res.status(401).json({ error: "Unauthorized. Please sign in again." });
  }
  (req as any).user = user;
  return next();
}

export function requireRoles(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as AuthUser | undefined;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: "Forbidden. Your account does not have access to this action." });
    }
    return next();
  };
}

export function getAuthUser(req: Request): AuthUser {
  return (req as any).user as AuthUser;
}

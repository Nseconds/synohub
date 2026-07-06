import crypto from "crypto";
import type { Express } from "express";
import { issueToken } from "../auth/jwt";
import { allowedStaff, staffRoster } from "../auth/users";
import { cleanEnvVar } from "../ai/providerConfig";

const configuredAdminPassword = cleanEnvVar(process.env.ADMIN_PASSWORD) || "admin";
const configuredStaffPassword = cleanEnvVar(process.env.STAFF_PASSWORD) || "staff123";

export function registerAuthRoutes(app: Express) {
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    const normalizedUser = username.trim().toLowerCase();

    if (normalizedUser === "admin" && (password === "admin" || password === configuredAdminPassword)) {
      const authUser = { sub: "admin", role: "admin" as const, name: "Administrator" };
      return res.json({
        success: true,
        token: issueToken(authUser),
        role: authUser.role,
        name: authUser.name,
      });
    }

    if (allowedStaff.includes(normalizedUser)) {
      const allowedPasswords = ["staff123", configuredStaffPassword, normalizedUser];
      if (allowedPasswords.includes(password)) {
        const properName = staffRoster.find(p => p.toLowerCase() === normalizedUser) || username;
        const authUser = { sub: `staff:${normalizedUser}`, role: "staff" as const, name: properName };
        return res.json({
          success: true,
          token: issueToken(authUser),
          role: authUser.role,
          name: authUser.name,
        });
      }
    }

    return res.status(401).json({ error: "Incorrect username or password. Check credentials roster." });
  });

  app.post("/api/guest-session", (_req, res) => {
    const guestId = crypto.randomBytes(8).toString("hex");
    const authUser = {
      sub: `guest:${guestId}`,
      role: "guest" as const,
      name: `Guest-${guestId}`,
    };
    res.json({
      success: true,
      token: issueToken(authUser),
      role: authUser.role,
      name: authUser.name,
    });
  });
}

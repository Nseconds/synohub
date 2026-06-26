import type { AuthUser } from "./users";
import { normalizeUserName, staffRoster } from "./users";

export function resolveChatIdentity(authUser: AuthUser, requestedTarget?: unknown) {
  const normalizedGuestName = normalizeUserName(authUser.name);
  const fallback = {
    role: authUser.role,
    name: authUser.role === "guest" ? normalizedGuestName : authUser.name.trim(),
    channel: authUser.role === "admin"
      ? "admin"
      : authUser.role === "staff"
        ? `staff:${authUser.name.trim()}`
        : `guest:${normalizedGuestName}`,
  };

  if (authUser.role !== "admin" || typeof requestedTarget !== "string") {
    return fallback;
  }

  const target = requestedTarget.trim();
  if (target === "admin") return { role: "admin" as const, name: authUser.name.trim(), channel: "admin" };
  if (target === "guest") return { role: "guest" as const, name: "guest", channel: "guest" };

  if (target.toLowerCase().startsWith("staff:")) {
    const rawStaffName = target.slice("staff:".length).trim();
    const matchedStaff = staffRoster.find(s => s.toLowerCase() === rawStaffName.toLowerCase());
    const staffName = matchedStaff || rawStaffName;
    if (staffName) return { role: "staff" as const, name: staffName, channel: `staff:${staffName}` };
  }

  return fallback;
}

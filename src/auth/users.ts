export type UserRole = "admin" | "staff" | "guest";

export interface AuthUser {
  sub: string;
  name: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export const staffRoster = [
  "Ajmal", "Amrutha", "Athul", "Celine", "Deepak", "Faizal", "Ivy", "Midhun",
  "Mohamed Musthafa", "Naseeb", "Nishad", "Rasick", "Reyn", "Shamnad", "Shams", "Shyamjith",
];

export const allowedStaff = staffRoster.map(name => name.toLowerCase());

export function normalizeUserName(name: string): string {
  return name.trim().toLowerCase();
}

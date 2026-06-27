export interface StoredUser {
  name: string;
  role: "admin" | "staff" | "guest";
  token: string;
}

export const isValidStoredUser = (value: unknown): value is StoredUser => {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as StoredUser).name === "string" &&
    typeof (value as StoredUser).role === "string" &&
    typeof (value as StoredUser).token === "string" &&
    (value as StoredUser).token.length > 0 &&
    ((value as StoredUser).role === "admin" || (value as StoredUser).role === "staff" || (value as StoredUser).role === "guest")
  );
};

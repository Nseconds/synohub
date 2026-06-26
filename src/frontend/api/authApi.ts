import { apiRequest } from "./apiClient";

export function login(username: string, password: string) {
  return apiRequest("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function createGuestSession() {
  return apiRequest("/api/guest-session", { method: "POST" });
}

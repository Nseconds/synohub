import { apiRequest } from "./apiClient";

export function sendChatMessage(body: unknown) {
  return apiRequest("/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function sendSafeQuery(body: unknown) {
  return apiRequest("/api/chat/query", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

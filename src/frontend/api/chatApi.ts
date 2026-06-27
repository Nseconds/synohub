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

export function fetchChatHistory(params: { target?: string; aiMode?: string; cacheBust?: number }) {
  const query = new URLSearchParams();
  if (params.target) query.set("target", params.target);
  if (params.aiMode) query.set("aiMode", params.aiMode);
  if (params.cacheBust) query.set("_", String(params.cacheBust));
  const queryString = query.toString();
  return apiRequest(`/api/chat/history${queryString ? `?${queryString}` : ""}`);
}

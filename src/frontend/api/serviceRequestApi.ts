import { apiRequest } from "./apiClient";

export function createLead(body: unknown) {
  return apiRequest("/api/leads/new", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createServiceRequest(body: unknown) {
  return apiRequest("/api/services", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

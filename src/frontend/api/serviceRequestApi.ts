import { apiRequest } from "./apiClient";

export function createLead(body: unknown) {
  return apiRequest("/api/leads/new", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateLead(id: number, body: unknown) {
  return apiRequest(`/api/leads/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function createServiceRequest(body: unknown) {
  return apiRequest("/api/services", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateServiceRequest(id: number, body: unknown) {
  return apiRequest(`/api/services/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

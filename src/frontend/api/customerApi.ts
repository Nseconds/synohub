import { apiRequest } from "./apiClient";

export function searchCustomers(q = "") {
  const query = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiRequest(`/api/customers${query}`);
}

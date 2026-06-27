import { apiRequest } from "./apiClient";

export function searchCustomers(q = "") {
  const query = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiRequest(`/api/customers${query}`);
}

export function updateCustomer(id: number, body: unknown) {
  return apiRequest(`/api/customers/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

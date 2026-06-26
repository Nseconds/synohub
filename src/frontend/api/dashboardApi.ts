import { apiRequest } from "./apiClient";

export function fetchDashboardData() {
  return apiRequest("/api/data");
}

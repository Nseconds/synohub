export class ApiRequestError extends Error {
  status: number;
  data: any;
  response: { status: number; data: any };

  constructor(status: number, data: any, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.data = data;
    this.response = { status, data };
  }
}

export async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const userStr = localStorage.getItem("synohub-user");
  let authHeaders: Record<string, string> = {};
  if (userStr) {
    try {
      const parsed = JSON.parse(userStr);
      if (parsed.token) {
        authHeaders = { Authorization: `Bearer ${parsed.token}` };
      }
    } catch {
      // Ignore invalid local storage values.
    }
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    if (response.status === 401) {
      try {
        localStorage.removeItem("synohub-user");
        window.dispatchEvent(new Event("synohub-auth-expired"));
      } catch {
        // Ignore unavailable browser APIs.
      }
    }
    throw new ApiRequestError(response.status, errorBody, errorBody.error || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

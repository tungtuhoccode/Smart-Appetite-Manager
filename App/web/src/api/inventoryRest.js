const DEFAULT_INVENTORY_API_URL =
  import.meta.env.VITE_INVENTORY_API_URL || "http://localhost:8001";

function normalizeBaseUrl(url) {
  return String(url || DEFAULT_INVENTORY_API_URL).trim().replace(/\/$/, "");
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function createApiError(response, payload) {
  const detail = payload?.detail ?? payload;
  const message =
    detail?.user_message ||
    detail?.message ||
    detail?.error ||
    `Request failed with ${response.status}`;
  const error = new Error(message);
  error.name = "InventoryRestApiError";
  error.status = response.status;
  error.payload = detail;
  return error;
}

export function createInventoryRestClient(baseUrl = DEFAULT_INVENTORY_API_URL) {
  const root = normalizeBaseUrl(baseUrl);

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const method = String(options.method || "GET").toUpperCase();
    const hasBody = options.body !== undefined && options.body !== null;
    const hasExplicitContentType = Object.keys(headers).some(
      (key) => key.toLowerCase() === "content-type"
    );

    if (hasBody && method !== "GET" && method !== "HEAD" && !hasExplicitContentType) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${root}${path}`, {
      ...options,
      headers,
    });

    const payload = await parseJsonSafely(response);
    if (!response.ok) {
      throw createApiError(response, payload);
    }
    return payload;
  }

  return {
    baseUrl: root,

    async health() {
      return request("/health", { method: "GET" });
    },

    async list(limit = 200) {
      return request(`/api/inventory/items?limit=${encodeURIComponent(limit)}`, {
        method: "GET",
      });
    },

    async deals(postalCode = "K1A 0A6", locale = "en-us") {
      const params = new URLSearchParams({ postal_code: postalCode, locale });
      return request(`/api/flyer/deals?${params}`, { method: "GET" });
    },
  };
}

export const inventoryRestApi = createInventoryRestClient();

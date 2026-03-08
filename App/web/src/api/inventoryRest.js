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
    const response = await fetch(`${root}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
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
  };
}

export const inventoryRestApi = createInventoryRestClient();

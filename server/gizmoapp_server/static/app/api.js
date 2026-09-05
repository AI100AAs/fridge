function runtimeTimeout() {
  return window.GizmoAppRuntime?.readConfig().requestTimeoutMs || 15000;
}

function userUrl(url) {
  const userId = window.GizmoAppRuntime?.readConfig().userId;
  if (!userId) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}user=${encodeURIComponent(userId)}`;
}


export async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || runtimeTimeout();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(userUrl(url), {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(`Server returned ${response.status} without a JSON response.`);
    }
    const payload = await response.json();
    if (!response.ok) {
      const message = payload.errors?.join("; ") || `Request failed with ${response.status}`;
      throw new Error(payload.requestId ? `${message} (request ${payload.requestId})` : message);
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}


export function fetchBootstrap(apiBase) {
  return requestJson(`${apiBase}/bootstrap`);
}


export function fetchCapabilities(apiBase) {
  return requestJson(`${apiBase}/capabilities`);
}


export function searchRecords(apiBase, query) {
  const params = new URLSearchParams({ q: query });
  return requestJson(`${apiBase}/search?${params.toString()}`);
}

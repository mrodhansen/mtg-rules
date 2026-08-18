import type { Health } from "./types.js";

export const API_READY_TIMEOUT_MS = 60_000;
export const API_READY_POLL_MS = 1_000;

export type HealthProbe =
  | { status: "ready"; health: Health }
  | { status: "not-ready"; reason: string };

export function isJsonContentType(contentType: string | null): boolean {
  if (contentType === null) return false;
  const mime = contentType.split(";")[0];
  if (mime === undefined) return false;
  return mime.trim().toLowerCase() === "application/json";
}

export function parseHealth(value: unknown): Health {
  if (typeof value !== "object" || value === null) {
    throw new Error("Health response is not an object");
  }
  if (!("ok" in value) || value.ok !== true) {
    throw new Error("Health response is not ok");
  }
  if (!("effectiveDate" in value) || typeof value.effectiveDate !== "string") {
    throw new Error("Health response missing effectiveDate");
  }
  if (!("rules" in value) || typeof value.rules !== "number") {
    throw new Error("Health response missing rules");
  }
  if (!("glossary" in value) || typeof value.glossary !== "number") {
    throw new Error("Health response missing glossary");
  }
  return {
    ok: true,
    effectiveDate: value.effectiveDate,
    rules: value.rules,
    glossary: value.glossary,
  };
}

function errorMessageFromBody(json: unknown, status: number): string {
  if (
    typeof json === "object" &&
    json !== null &&
    "error" in json &&
    typeof json.error === "string"
  ) {
    return json.error;
  }
  return `HTTP ${status}`;
}

export async function readJson(res: Response): Promise<unknown> {
  if (!isJsonContentType(res.headers.get("content-type"))) {
    const ct = res.headers.get("content-type") ?? "missing content-type";
    throw new Error(`Expected application/json, got ${ct} (HTTP ${res.status})`);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Invalid JSON (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(errorMessageFromBody(json, res.status));
  }
  return json;
}

export async function evaluateHealthResponse(res: Response): Promise<HealthProbe> {
  if (res.headers.get("x-sablier-session-status") === "not-ready") {
    return { status: "not-ready", reason: "Sablier session not ready" };
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return { status: "not-ready", reason: `HTTP ${res.status}` };
  }
  if (res.status !== 200) {
    return { status: "not-ready", reason: `HTTP ${res.status}` };
  }
  if (!isJsonContentType(res.headers.get("content-type"))) {
    const ct = res.headers.get("content-type") ?? "missing content-type";
    return { status: "not-ready", reason: `Expected application/json, got ${ct}` };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { status: "not-ready", reason: "Health body is not valid JSON" };
  }
  try {
    return { status: "ready", health: parseHealth(json) };
  } catch (err) {
    return { status: "not-ready", reason: err instanceof Error ? err.message : String(err) };
  }
}

function timeoutError(timeoutMs: number, lastReason: string): Error {
  const seconds = timeoutMs / 1000;
  const label = Number.isInteger(seconds) ? `${seconds}s` : `${timeoutMs}ms`;
  return new Error(`API did not become ready within ${label}: ${lastReason}`);
}

export async function waitForHealth(
  url: string,
  timeoutMs = API_READY_TIMEOUT_MS,
  intervalMs = API_READY_POLL_MS
): Promise<Health> {
  if (timeoutMs <= 0) {
    throw new Error("API wait timeout must be positive");
  }
  const deadline = Date.now() + timeoutMs;
  let lastReason = "not ready";

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const controller = new AbortController();
    const abortTimer = setTimeout(() => {
      controller.abort();
    }, remaining);

    try {
      const res = await globalThis.fetch(url, { signal: controller.signal, cache: "no-store" });
      const probe = await evaluateHealthResponse(res);
      if (probe.status === "ready") {
        return probe.health;
      }
      lastReason = probe.reason;
    } catch (err) {
      if (Date.now() >= deadline || controller.signal.aborted) {
        throw timeoutError(timeoutMs, lastReason);
      }
      lastReason = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(abortTimer);
    }

    const sleepFor = Math.min(intervalMs, deadline - Date.now());
    if (sleepFor <= 0) break;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, sleepFor);
    });
  }

  throw timeoutError(timeoutMs, lastReason);
}

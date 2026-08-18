import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  evaluateHealthResponse,
  isJsonContentType,
  parseHealth,
  readJson,
  waitForHealth,
} from "../frontend/src/health.js";

const healthBody = {
  ok: true as const,
  effectiveDate: "2024-08-02",
  rules: 12,
  glossary: 3,
};

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

describe("isJsonContentType", () => {
  it("accepts application/json with charset", () => {
    assert.equal(isJsonContentType("application/json; charset=utf-8"), true);
  });

  it("rejects html and missing", () => {
    assert.equal(isJsonContentType("text/html"), false);
    assert.equal(isJsonContentType(null), false);
  });
});

describe("parseHealth", () => {
  it("accepts the server health shape", () => {
    assert.deepEqual(parseHealth(healthBody), healthBody);
  });

  it("rejects missing fields and ok:false", () => {
    assert.throws(() => parseHealth({ ok: false }), /not ok/);
    assert.throws(() => parseHealth({ ok: true }), /effectiveDate/);
    assert.throws(() => parseHealth("<html>"), /not an object/);
  });
});

describe("readJson", () => {
  it("throws on Sablier HTML 200 instead of treating it as success", async () => {
    const res = new Response("<html>Starting…</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    await assert.rejects(() => readJson(res), /Expected application\/json/);
  });

  it("returns parsed JSON on 200 application/json", async () => {
    assert.deepEqual(await readJson(jsonResponse(healthBody)), healthBody);
  });

  it("throws API error message on JSON error body", async () => {
    await assert.rejects(
      () => readJson(jsonResponse({ error: "Card name is required" }, { status: 400 })),
      { message: "Card name is required" }
    );
  });
});

describe("evaluateHealthResponse", () => {
  it("is ready only for 200 JSON health", async () => {
    const probe = await evaluateHealthResponse(jsonResponse(healthBody));
    assert.deepEqual(probe, { status: "ready", health: healthBody });
  });

  it("is not ready for Sablier HTML, not-ready header, and gateway errors", async () => {
    const html = await evaluateHealthResponse(
      new Response("<html>waiting</html>", { status: 200, headers: { "content-type": "text/html" } })
    );
    assert.equal(html.status, "not-ready");

    const sablier = await evaluateHealthResponse(
      new Response("<html>waiting</html>", {
        status: 200,
        headers: { "content-type": "text/html", "X-Sablier-Session-Status": "not-ready" },
      })
    );
    assert.deepEqual(sablier, { status: "not-ready", reason: "Sablier session not ready" });

    const badGateway = await evaluateHealthResponse(new Response("bad", { status: 502 }));
    assert.deepEqual(badGateway, { status: "not-ready", reason: "HTTP 502" });
  });

  it("is not ready when JSON is not the health shape", async () => {
    const probe = await evaluateHealthResponse(jsonResponse({ ok: true }));
    assert.equal(probe.status, "not-ready");
  });
});

describe("waitForHealth", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves when health JSON succeeds after not-ready probes", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls < 3) {
        return new Response("<html>waiting</html>", {
          status: 200,
          headers: { "content-type": "text/html", "X-Sablier-Session-Status": "not-ready" },
        });
      }
      return jsonResponse(healthBody);
    };

    const health = await waitForHealth("http://example.test/api/health", 500, 10);
    assert.deepEqual(health, healthBody);
    assert.equal(calls, 3);
  });

  it("throws after timeout instead of returning fake ready", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    };

    await assert.rejects(
      () => waitForHealth("http://example.test/api/health", 40, 10),
      /did not become ready/
    );
    assert.ok(calls >= 1);
  });
});

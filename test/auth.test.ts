import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveXaiToken } from "../src/auth.js";

describe("resolveXaiToken", () => {
  it("uses OpenCode oauth access when unexpired", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mtg-auth-"));
    const path = join(dir, "auth.json");
    writeFileSync(
      path,
      JSON.stringify({
        xai: {
          type: "oauth",
          access: "oauth-access-token",
          refresh: "oauth-refresh-token",
          expires: Date.now() + 3_600_000,
        },
      })
    );
    process.env.OPENCODE_AUTH_PATH = path;
    delete process.env.XAI_USE_API_KEY;
    process.env.XAI_API_KEY = "should-not-win";
    assert.equal(await resolveXaiToken(), "oauth-access-token");
  });

  it("uses XAI_API_KEY when forced", async () => {
    process.env.XAI_USE_API_KEY = "1";
    process.env.XAI_API_KEY = "console-key";
    assert.equal(await resolveXaiToken(), "console-key");
    delete process.env.XAI_USE_API_KEY;
  });
});

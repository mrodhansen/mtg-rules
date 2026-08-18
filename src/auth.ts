import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const REFRESH_URL = "https://auth.x.ai/oauth2/token";
const SKEW_MS = 60_000;

const OauthSchema = z.object({
  type: z.literal("oauth"),
  access: z.string().min(1),
  refresh: z.string().min(1),
  expires: z.number().int(),
});

const AuthFileSchema = z.object({
  xai: OauthSchema.optional(),
});

export function opencodeAuthPath(): string {
  return process.env.OPENCODE_AUTH_PATH ?? join(homedir(), ".local/share/opencode/auth.json");
}

function readAuthFile(path: string): z.infer<typeof AuthFileSchema> {
  if (!existsSync(path)) {
    throw new Error(`OpenCode auth file not found: ${path}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`OpenCode auth file is not valid JSON: ${path}`);
  }
  const parsed = AuthFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`OpenCode auth file failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function refreshOauth(
  current: z.infer<typeof OauthSchema>
): Promise<z.infer<typeof OauthSchema>> {
  const res = await fetch(REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refresh,
      client_id: XAI_CLIENT_ID,
    }),
  });
  const json: unknown = await res.json();
  if (!res.ok) {
    throw new Error(`xAI OAuth refresh failed HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  const Token = z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    expires_in: z.number().int().positive(),
  });
  const parsed = Token.safeParse(json);
  if (!parsed.success) {
    throw new Error(`xAI OAuth refresh payload invalid: ${parsed.error.message}`);
  }
  return {
    type: "oauth",
    access: parsed.data.access_token,
    refresh: parsed.data.refresh_token,
    expires: Date.now() + parsed.data.expires_in * 1000,
  };
}

function writeOauth(path: string, next: z.infer<typeof OauthSchema>): void {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!raw || typeof raw !== "object") {
    throw new Error(`OpenCode auth file is not an object: ${path}`);
  }
  const out = { ...(raw as Record<string, unknown>), xai: next };
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export async function resolveXaiToken(): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  const forceKey = process.env.XAI_USE_API_KEY === "1";
  if (forceKey) {
    if (!apiKey) throw new Error("XAI_USE_API_KEY=1 but XAI_API_KEY is unset");
    return apiKey;
  }

  const path = opencodeAuthPath();
  if (existsSync(path)) {
    const file = readAuthFile(path);
    if (!file.xai) {
      throw new Error(`No xAI OAuth in ${path}. Run /connect xai in OpenCode, or set XAI_API_KEY.`);
    }
    let oauth = file.xai;
    if (oauth.expires - SKEW_MS <= Date.now()) {
      oauth = await refreshOauth(oauth);
      writeOauth(path, oauth);
    }
    return oauth.access;
  }

  if (apiKey) return apiKey;
  throw new Error(
    "No xAI credentials. Log into Grok via OpenCode /connect, or set XAI_API_KEY."
  );
}

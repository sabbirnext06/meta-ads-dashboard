import fs from "fs";
import path from "path";
import { cookies } from "next/headers";

// Local dev: file-based token cache
const TOKEN_FILE = path.join(process.cwd(), ".cache", "token.json");
const COOKIE_NAME = "meta_token";

export interface TokenData {
  access_token: string;
  expires_at: number; // unix ms
  obtained_at: number;
}

// ── File helpers (local dev only) ────────────────────────────────────────────

export function readTokenFile(): TokenData | null {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8")) as TokenData;
  } catch {
    return null;
  }
}

export function writeTokenFile(data: TokenData) {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
  } catch { /* non-fatal */ }
}

export function clearTokenFile() {
  try { fs.unlinkSync(TOKEN_FILE); } catch { /* already gone */ }
}

// ── Cookie helpers (Vercel) ───────────────────────────────────────────────────

export function tokenCookieOptions(expiresAt: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
  };
}

// ── Token read (async — works in both route handlers and server components) ───

export async function readTokenData(): Promise<TokenData | null> {
  // Always check env var first (manual override for production)
  if (process.env.META_ACCESS_TOKEN) {
    return {
      access_token: process.env.META_ACCESS_TOKEN,
      expires_at: Date.now() + 60 * 24 * 60 * 60 * 1000, // assume 60 days
      obtained_at: Date.now(),
    };
  }

  if (process.env.VERCEL) {
    // On Vercel: read from HttpOnly cookie (survives across serverless instances)
    try {
      const jar = await cookies();
      const c = jar.get(COOKIE_NAME);
      if (!c) return null;
      return JSON.parse(c.value) as TokenData;
    } catch { return null; }
  }

  // Local dev: read from file
  return readTokenFile();
}

export async function getValidToken(): Promise<string | null> {
  const data = await readTokenData();
  if (!data) return null;
  if (data.expires_at && Date.now() > data.expires_at - 10 * 60 * 1000) return null;
  return data.access_token;
}

export function tokenExpiresIn(data: TokenData): string {
  const ms = data.expires_at - Date.now();
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86400000);
  if (days > 0) return `${days} day${days !== 1 ? "s" : ""}`;
  const hrs = Math.floor(ms / 3600000);
  return `${hrs} hour${hrs !== 1 ? "s" : ""}`;
}

import fs from "fs";
import path from "path";

// On Vercel serverless, write to /tmp (ephemeral but works within warm instances).
// Locally, write to .cache/ (persists across restarts).
const TOKEN_FILE = process.env.VERCEL
  ? "/tmp/meta-token.json"
  : path.join(process.cwd(), ".cache", "token.json");

export interface TokenData {
  access_token: string;
  expires_at: number; // unix ms
  obtained_at: number;
}

export function readTokenFile(): TokenData | null {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8")) as TokenData;
  } catch {
    return null;
  }
}

export function writeTokenFile(data: TokenData) {
  try {
    if (!process.env.VERCEL) {
      fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    }
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
  } catch { /* non-fatal */ }
}

export function clearTokenFile() {
  try { fs.unlinkSync(TOKEN_FILE); } catch { /* already gone */ }
}

export function getValidToken(): string | null {
  // Env var takes priority — set META_ACCESS_TOKEN in Vercel dashboard for production
  if (process.env.META_ACCESS_TOKEN) return process.env.META_ACCESS_TOKEN;

  const data = readTokenFile();
  if (!data) return null;
  // 10-minute buffer before expiry
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

import fs from "fs";
import path from "path";

const TOKEN_FILE = path.join(process.cwd(), ".cache", "token.json");

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
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
}

export function clearTokenFile() {
  try { fs.unlinkSync(TOKEN_FILE); } catch { /* already gone */ }
}

/** Returns a valid token string, or null if missing/expired. */
export function getValidToken(): string | null {
  const data = readTokenFile();
  if (!data) return null;
  // 10-minute buffer before expiry
  if (data.expires_at && Date.now() > data.expires_at - 10 * 60 * 1000) return null;
  return data.access_token;
}

/** Human-readable expiry string, e.g. "59 days" */
export function tokenExpiresIn(data: TokenData): string {
  const ms = data.expires_at - Date.now();
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86400000);
  if (days > 0) return `${days} day${days !== 1 ? "s" : ""}`;
  const hrs = Math.floor(ms / 3600000);
  return `${hrs} hour${hrs !== 1 ? "s" : ""}`;
}

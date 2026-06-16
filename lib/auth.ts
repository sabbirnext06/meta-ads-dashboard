import { createHmac } from "crypto";

export function makeSessionToken(): string {
  const p = process.env.DASHBOARD_PASSWORD ?? "";
  return createHmac("sha256", p + "ds-v1").update("session").digest("hex");
}

export function checkAuth(request: Request): boolean {
  if (!process.env.DASHBOARD_PASSWORD) return true; // open if no password configured
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = /(?:^|;\s*)ds_auth=([^;]+)/.exec(cookieHeader);
  if (!match) return false;
  return match[1] === makeSessionToken();
}

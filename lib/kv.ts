// Fetch-based KV client — works with Vercel KV or standalone Upstash, no npm package needed.
// Env vars: KV_REST_API_URL + KV_REST_API_TOKEN  (Vercel KV auto-populates these)
// Fallback:  UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (standalone Upstash)

const BASE = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

function configured(): boolean {
  return !!(BASE && TOKEN);
}

async function cmd(command: unknown[]): Promise<{ result: unknown }> {
  const res = await fetch(BASE!, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  return res.json();
}

export async function kvGet<T>(key: string): Promise<T | null> {
  if (!configured()) return null;
  try {
    const { result } = await cmd(["GET", key]);
    if (result === null || result === undefined) return null;
    return JSON.parse(result as string) as T;
  } catch { return null; }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  if (!configured()) return;
  try { await cmd(["SET", key, JSON.stringify(value)]); }
  catch { /* non-fatal */ }
}

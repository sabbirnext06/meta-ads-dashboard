import { NextResponse } from "next/server";
import { unstable_cache, revalidateTag } from "next/cache";

// Increase Vercel function timeout to 60s (Pro plan) to handle large ad accounts
export const maxDuration = 60;
import fs from "fs";
import path from "path";
import { getValidToken, readTokenFile, tokenExpiresIn } from "@/lib/token";
import type { MetaAd, GroupedAds } from "@/types/meta";

const GRAPH_URL = "https://graph.facebook.com/v21.0";
const FIELDS =
  "id,name,status,creative{id,name,object_type,thumbnail_url,image_url},adset{id,name,status,daily_budget,campaign{id,name,status,objective}}";

// ── Local file cache (dev only) ──────────────────────────────────────────────
const LOCAL_CACHE_FILE = path.join(process.cwd(), ".cache", "ads.json");
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

type CachePayload = GroupedAds & { cachedAt: number };

function readLocalCache(): CachePayload | null {
  try { return JSON.parse(fs.readFileSync(LOCAL_CACHE_FILE, "utf-8")); } catch { return null; }
}
function writeLocalCache(p: CachePayload) {
  try { fs.mkdirSync(path.dirname(LOCAL_CACHE_FILE), { recursive: true }); fs.writeFileSync(LOCAL_CACHE_FILE, JSON.stringify(p)); } catch { /* non-fatal */ }
}

// ── Fetch helpers ────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RateLimitError extends Error {
  resetInMinutes: number;
  constructor(message: string, resetInMinutes: number) {
    super(message);
    this.name = "RateLimitError";
    this.resetInMinutes = resetInMinutes;
  }
}

// Parses Meta's X-Business-Use-Case-Usage header and returns minutes until reset (0 = not limited)
function parseRateLimitReset(header: string | null): number {
  if (!header) return 0;
  try {
    const parsed = JSON.parse(header) as Record<string, { estimated_time_to_regain_access?: number; call_count?: number }[]>;
    const entry = Object.values(parsed)[0]?.[0];
    return entry?.estimated_time_to_regain_access ?? 0;
  } catch { return 0; }
}

class OverloadError extends Error {
  constructor() { super("overload"); this.name = "OverloadError"; }
}

async function fetchPagedAds(accountId: string, token: string, pageSize: number): Promise<MetaAd[]> {
  const allAds: MetaAd[] = [];
  const effectiveStatus = encodeURIComponent(JSON.stringify(["ACTIVE"]));
  let url: string | null =
    `${GRAPH_URL}/act_${accountId}/ads?effective_status=${effectiveStatus}&fields=${FIELDS}&limit=${pageSize}&access_token=${token}`;
  let page = 0;

  while (url) {
    if (page > 0) await sleep(200); // 200ms between pages (rate limit is hourly count, not per-second)
    page++;
    const res: Response = await fetch(url, { cache: "no-store" });

    const resetIn = parseRateLimitReset(res.headers.get("x-business-use-case-usage"));
    if (resetIn > 0) {
      throw new RateLimitError(`Meta rate limit reached. Quota resets in ~${resetIn} minute${resetIn !== 1 ? "s" : ""}.`, resetIn);
    }

    const data: { data?: MetaAd[]; error?: { message: string; code?: number }; paging?: { next?: string } } = await res.json();
    if (data.error) {
      const msg = data.error.message ?? "";
      const isRateLimit = data.error.code === 17 || msg.toLowerCase().includes("too many calls");
      if (isRateLimit) throw new RateLimitError("Meta rate limit reached. Please wait a few minutes and click Refresh.", 5);
      if (msg.toLowerCase().includes("please reduce")) throw new OverloadError();
      throw new Error(msg);
    }
    allAds.push(...(data.data ?? []));
    url = data.paging?.next ?? null;
  }
  return allAds;
}

// Auto-retries with smaller page sizes: 100 → 50 → 25
async function fetchAllAds(accountId: string, token: string): Promise<MetaAd[]> {
  for (const pageSize of [100, 50, 25]) {
    try {
      return await fetchPagedAds(accountId, token, pageSize);
    } catch (err) {
      if (err instanceof OverloadError && pageSize > 25) {
        await sleep(500);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Meta API rejected all page sizes. Please try again later.");
}

function groupAds(ads: MetaAd[]): GroupedAds {
  const campaigns: GroupedAds["campaigns"] = {};
  for (const ad of ads) {
    const { campaign, ...adsetWithoutCampaign } = ad.adset;
    const cId = campaign.id;
    const aId = adsetWithoutCampaign.id;
    if (!campaigns[cId]) campaigns[cId] = { campaign, adsets: {}, adCount: 0 };
    if (!campaigns[cId].adsets[aId]) campaigns[cId].adsets[aId] = { adset: adsetWithoutCampaign, ads: [] };
    campaigns[cId].adsets[aId].ads.push(ad);
    campaigns[cId].adCount++;
  }
  const totalAdSets = Object.values(campaigns).reduce((n, c) => n + Object.keys(c.adsets).length, 0);
  return { campaigns, totalAds: ads.length, totalCampaigns: Object.keys(campaigns).length, totalAdSets };
}

// ── Vercel-native cache via Next.js Data Cache ───────────────────────────────
// Persists across ALL serverless instances — survives cold starts.
// Revalidated every 2 hours or on-demand via revalidateTag("meta-ads").
const getVercelCachedAds = unstable_cache(
  async (accountId: string) => {
    const token = getValidToken();
    if (!token) throw new Error("NEEDS_AUTH");
    const ads = await fetchAllAds(accountId, token);
    return { ...groupAds(ads), cachedAt: Date.now() } as CachePayload;
  },
  ["meta-ads"],
  { revalidate: 7200, tags: ["meta-ads"] },
);

// ── Route handler ────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!accountId) return NextResponse.json({ error: "META_AD_ACCOUNT_ID must be set" }, { status: 500 });

  const token = getValidToken();
  if (!token) return NextResponse.json({ needsAuth: true }, { status: 401 });

  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "true";
  const businessId = process.env.META_BUSINESS_ID ?? "";
  const tokenMeta = { accountId, businessId, tokenExpiresIn: readTokenFile() ? tokenExpiresIn(readTokenFile()!) : null };

  // ── Vercel: use Next.js Data Cache (shared across all instances) ──────────
  if (process.env.VERCEL) {
    if (forceRefresh) revalidateTag("meta-ads");
    try {
      const data = await getVercelCachedAds(accountId);
      return NextResponse.json({ ...data, ...tokenMeta });
    } catch (err) {
      if (err instanceof RateLimitError) {
        return NextResponse.json(
          { error: err.message, rateLimitResetMinutes: err.resetInMinutes },
          { status: 429 },
        );
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message === "NEEDS_AUTH") return NextResponse.json({ needsAuth: true }, { status: 401 });
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // ── Local dev: use file cache ─────────────────────────────────────────────
  const now = Date.now();
  const disk = readLocalCache();

  if (disk && !forceRefresh && now - disk.cachedAt < CACHE_TTL_MS) {
    return NextResponse.json({ ...disk, ...tokenMeta });
  }

  try {
    const ads = await fetchAllAds(accountId, token);
    const payload: CachePayload = { ...groupAds(ads), cachedAt: now };
    writeLocalCache(payload);
    return NextResponse.json({ ...payload, ...tokenMeta });
  } catch (err) {
    if (err instanceof RateLimitError) {
      if (disk) {
        const ageMin = Math.round((now - disk.cachedAt) / 60000);
        return NextResponse.json({
          ...disk, ...tokenMeta,
          warning: `Meta rate limit — showing cached data from ${ageMin} min ago. Resets in ~${err.resetInMinutes} min.`,
        });
      }
      return NextResponse.json({ error: err.message, rateLimitResetMinutes: err.resetInMinutes }, { status: 429 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

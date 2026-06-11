import { NextResponse } from "next/server";
import { unstable_cache, revalidateTag } from "next/cache";
import { getValidToken, readTokenData, tokenExpiresIn } from "@/lib/token";
import type { MetaAd, MetaCampaign, AdsByAdSet, MetaAdInsights } from "@/types/meta";

export const maxDuration = 60;

const GRAPH_URL = "https://graph.facebook.com/v21.0";

// No insights nested here — fetched in a separate bulk call, much faster
const AD_FIELDS =
  "id,name,status,creative{id,object_type,thumbnail_url,image_url}," +
  "adset{id,name,status,daily_budget,campaign{id,name,status,objective}}";

// ── Error types ───────────────────────────────────────────────────────────────

class RateLimitError extends Error {
  resetInMinutes: number;
  constructor(msg: string, reset: number) {
    super(msg); this.name = "RateLimitError"; this.resetInMinutes = reset;
  }
}

class OverloadError extends Error {
  constructor() { super("overload"); this.name = "OverloadError"; }
}

function parseRateLimitReset(header: string | null): number {
  if (!header) return 0;
  try {
    const p = JSON.parse(header) as Record<string, { estimated_time_to_regain_access?: number }[]>;
    return Object.values(p)[0]?.[0]?.estimated_time_to_regain_access ?? 0;
  } catch { return 0; }
}

// ── Generic cursor-paged fetcher ──────────────────────────────────────────────

async function fetchPaged<T>(firstUrl: string): Promise<T[]> {
  const all: T[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const res = await fetch(url, { cache: "no-store" });
    const reset = parseRateLimitReset(res.headers.get("x-business-use-case-usage"));
    if (reset > 0) throw new RateLimitError(`Rate limit — resets in ~${reset} min.`, reset);

    let body: { data?: T[]; error?: { message: string; code?: number }; paging?: { next?: string } };
    try { body = await res.json(); }
    catch { throw new Error(`Server error (${res.status}). Try again.`); }

    if (body.error) {
      const msg = body.error.message ?? "";
      if (body.error.code === 17 || msg.toLowerCase().includes("too many calls"))
        throw new RateLimitError("Rate limit reached — wait a few minutes then retry.", 5);
      if (msg.toLowerCase().includes("please reduce")) throw new OverloadError();
      throw new Error(msg);
    }
    all.push(...(body.data ?? []));
    url = body.paging?.next ?? null;
  }
  return all;
}

// ── Bulk ad fetch — ALL active ads, no campaign filter, no insights ───────────

async function fetchAllAds(accountId: string, token: string): Promise<MetaAd[]> {
  const es = encodeURIComponent(JSON.stringify(["ACTIVE"]));
  for (const limit of [200, 100, 50]) {
    try {
      return await fetchPaged<MetaAd>(
        `${GRAPH_URL}/act_${accountId}/ads?effective_status=${es}&fields=${AD_FIELDS}&limit=${limit}&access_token=${token}`,
      );
    } catch (err) {
      if (err instanceof OverloadError && limit > 50) continue;
      throw err;
    }
  }
  throw new Error("Meta API rejected request. Try again later.");
}

// ── Bulk insights fetch — ALL active ads in one stream ────────────────────────

interface AdInsightRecord {
  ad_id: string;
  spend?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

async function fetchAllInsights(
  accountId: string,
  token: string,
): Promise<Map<string, MetaAdInsights>> {
  try {
    const records = await fetchPaged<AdInsightRecord>(
      `${GRAPH_URL}/act_${accountId}/insights?level=ad&fields=ad_id,spend,actions&date_preset=lifetime&limit=500&access_token=${token}`,
    );
    console.log(`[insights] ${records.length} ad records`);
    return new Map(records.map((r) => [r.ad_id, { spend: r.spend, actions: r.actions }]));
  } catch (err) {
    console.error("[insights] failed:", err instanceof Error ? err.message : err);
    return new Map();
  }
}

// ── Group flat ad list into campaigns ─────────────────────────────────────────

export type CampaignWithAds = {
  campaign: MetaCampaign;
  adsets: Record<string, AdsByAdSet>;
  adCount: number;
};

function groupByCampaign(ads: MetaAd[]): CampaignWithAds[] {
  const map = new Map<string, CampaignWithAds>();
  const order: string[] = [];
  for (const ad of ads) {
    const campaign = ad.adset.campaign;
    if (!map.has(campaign.id)) {
      map.set(campaign.id, { campaign, adsets: {}, adCount: 0 });
      order.push(campaign.id);
    }
    const entry = map.get(campaign.id)!;
    const { campaign: _c, ...adset } = ad.adset;
    if (!entry.adsets[adset.id]) entry.adsets[adset.id] = { adset, ads: [] };
    entry.adsets[adset.id].ads.push(ad);
    entry.adCount++;
  }
  return order.map((id) => map.get(id)!);
}

// ── Single cached fetch: all ads + all insights in parallel ───────────────────

const getCachedAllData = unstable_cache(
  async (accountId: string, token: string) => {
    // ~5 pages of ads + ~3 pages of insights, both running in parallel
    // Total Meta API calls: ~8 (vs 1342 with per-campaign approach)
    const [ads, insightsMap] = await Promise.all([
      fetchAllAds(accountId, token),
      fetchAllInsights(accountId, token),
    ]);
    const adsWithInsights = ads.map((ad) => ({
      ...ad,
      insights: insightsMap.has(ad.id) ? { data: [insightsMap.get(ad.id)!] } : undefined,
    }));
    const campaigns = groupByCampaign(adsWithInsights);
    return { campaigns, totalAds: ads.length, insightsCount: insightsMap.size, cachedAt: Date.now() };
  },
  ["meta-all-ads"],
  { revalidate: 7200, tags: ["meta-ads"] },
);

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("refresh") === "true";

  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!accountId) return NextResponse.json({ error: "META_AD_ACCOUNT_ID not set" }, { status: 500 });

  const token = await getValidToken();
  if (!token) return NextResponse.json({ needsAuth: true }, { status: 401 });

  if (forceRefresh) revalidateTag("meta-ads");

  const businessId = process.env.META_BUSINESS_ID ?? "";
  const tokenData = await readTokenData();
  const tokenMeta = {
    accountId,
    businessId,
    tokenExpiresIn: tokenData ? tokenExpiresIn(tokenData) : null,
  };

  try {
    const data = await getCachedAllData(accountId, token);
    return NextResponse.json({ ...data, ...tokenMeta });
  } catch (err) {
    if (err instanceof RateLimitError)
      return NextResponse.json(
        { error: err.message, rateLimitResetMinutes: err.resetInMinutes },
        { status: 429 },
      );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

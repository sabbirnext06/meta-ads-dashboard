import { NextResponse } from "next/server";
import { unstable_cache, revalidateTag } from "next/cache";
import { getValidToken, readTokenData, tokenExpiresIn } from "@/lib/token";
import type { MetaAd, MetaCampaign, AdsByAdSet, MetaAdInsights } from "@/types/meta";

export const maxDuration = 60;

const GRAPH_URL = "https://graph.facebook.com/v21.0";

// Initial load: campaign metadata only — 1–2 API calls, always fast
const CAMPAIGN_FIELDS = "id,name,status,objective";

// Insights NOT nested here — fetched separately in parallel so each request stays lightweight
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

// ── Campaign list (fast initial load) ────────────────────────────────────────

const getCachedCampaigns = unstable_cache(
  async (accountId: string, token: string) => {
    const es = encodeURIComponent(JSON.stringify(["ACTIVE"]));
    const campaigns = await fetchPaged<MetaCampaign>(
      `${GRAPH_URL}/act_${accountId}/campaigns?effective_status=${es}&fields=${CAMPAIGN_FIELDS}&limit=500&access_token=${token}`,
    );
    return { campaigns, cachedAt: Date.now() };
  },
  ["meta-campaigns"],
  { revalidate: 7200, tags: ["meta-ads"] },
);

// ── Per-campaign ads (loaded lazily per campaign) ─────────────────────────────

function groupByAdSet(ads: MetaAd[]): Record<string, AdsByAdSet> {
  const out: Record<string, AdsByAdSet> = {};
  for (const ad of ads) {
    const { campaign: _c, ...adset } = ad.adset;
    if (!out[adset.id]) out[adset.id] = { adset, ads: [] };
    out[adset.id].ads.push(ad);
  }
  return out;
}

// Fetch ads without insights — lightweight, fast pages
async function fetchCampaignAds(
  accountId: string,
  token: string,
  campaignId: string,
): Promise<MetaAd[]> {
  const es = encodeURIComponent(JSON.stringify(["ACTIVE"]));
  const filter = encodeURIComponent(
    JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: campaignId }]),
  );
  for (const limit of [100, 50]) {
    try {
      return await fetchPaged<MetaAd>(
        `${GRAPH_URL}/act_${accountId}/ads?effective_status=${es}&filtering=${filter}&fields=${AD_FIELDS}&limit=${limit}&access_token=${token}`,
      );
    } catch (err) {
      if (err instanceof OverloadError && limit > 50) continue;
      throw err;
    }
  }
  throw new Error("Meta API rejected request. Try again later.");
}

// Fetch lifetime insights for all active ads in the campaign (single call, parallel with ads)
interface AdInsightRecord {
  ad_id: string;
  spend?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

async function fetchCampaignInsights(
  accountId: string,
  token: string,
  campaignId: string,
): Promise<Map<string, MetaAdInsights>> {
  try {
    const filter = encodeURIComponent(
      JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: campaignId }]),
    );
    const records = await fetchPaged<AdInsightRecord>(
      `${GRAPH_URL}/act_${accountId}/insights?level=ad&filtering=${filter}&fields=ad_id,spend,actions&date_preset=lifetime&limit=500&access_token=${token}`,
    );
    return new Map(records.map((r) => [r.ad_id, { spend: r.spend, actions: r.actions }]));
  } catch {
    return new Map(); // insights are supplementary — never block ad display
  }
}

const getCachedCampaignAds = unstable_cache(
  async (accountId: string, token: string, campaignId: string) => {
    // Run ads and insights in parallel — each call is now lightweight
    const [ads, insightsMap] = await Promise.all([
      fetchCampaignAds(accountId, token, campaignId),
      fetchCampaignInsights(accountId, token, campaignId),
    ]);
    const adsWithInsights = ads.map((ad) => ({
      ...ad,
      insights: insightsMap.has(ad.id) ? { data: [insightsMap.get(ad.id)!] } : undefined,
    }));
    return { adsets: groupByAdSet(adsWithInsights), adCount: ads.length, cachedAt: Date.now() };
  },
  ["meta-campaign-ads"],
  { revalidate: 7200, tags: ["meta-ads"] },
);

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get("campaignId");
  const forceRefresh = searchParams.get("refresh") === "true";

  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!accountId) return NextResponse.json({ error: "META_AD_ACCOUNT_ID not set" }, { status: 500 });

  const token = await getValidToken();
  if (!token) return NextResponse.json({ needsAuth: true }, { status: 401 });

  // One revalidateTag call clears both campaign list and all per-campaign caches
  if (forceRefresh) revalidateTag("meta-ads");

  const businessId = process.env.META_BUSINESS_ID ?? "";
  const tokenData = await readTokenData();
  const tokenMeta = {
    accountId,
    businessId,
    tokenExpiresIn: tokenData ? tokenExpiresIn(tokenData) : null,
  };

  try {
    if (campaignId) {
      const data = await getCachedCampaignAds(accountId, token, campaignId);
      return NextResponse.json({ ...data, ...tokenMeta });
    }
    const data = await getCachedCampaigns(accountId, token);
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

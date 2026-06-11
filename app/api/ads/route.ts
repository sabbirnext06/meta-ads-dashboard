import { NextResponse } from "next/server";
import { unstable_cache, revalidateTag } from "next/cache";
import { getValidToken, readTokenData, tokenExpiresIn } from "@/lib/token";
import type { MetaAd, MetaCampaign, AdsByAdSet } from "@/types/meta";

export const maxDuration = 60;

const GRAPH_URL = "https://graph.facebook.com/v21.0";

// Initial load: campaign metadata only — 1–2 API calls, always fast
const CAMPAIGN_FIELDS = "id,name,status,objective";

// Per-campaign: full ad data in a single pass (each campaign is small enough)
const AD_FIELDS =
  "id,name,status,creative{id,object_type,thumbnail_url,image_url}," +
  "adset{id,name,status,daily_budget,campaign{id,name,status,objective}}," +
  "insights.date_preset(lifetime){spend,actions}";

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

const getCachedCampaignAds = unstable_cache(
  async (accountId: string, token: string, campaignId: string) => {
    const es = encodeURIComponent(JSON.stringify(["ACTIVE"]));
    const filter = encodeURIComponent(
      JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: campaignId }]),
    );
    const ads = await fetchPaged<MetaAd>(
      `${GRAPH_URL}/act_${accountId}/ads?effective_status=${es}&filtering=${filter}&fields=${AD_FIELDS}&limit=200&access_token=${token}`,
    );
    return { adsets: groupByAdSet(ads), adCount: ads.length, cachedAt: Date.now() };
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

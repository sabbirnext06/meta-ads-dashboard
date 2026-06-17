import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";
import { kvGet, kvSet } from "@/lib/kv";
import type { MetaAd, MetaCampaign, AdsByAdSet } from "@/types/meta";

export const maxDuration = 60;

const GRAPH_URL = "https://graph.facebook.com/v21.0";
const CAMPAIGN_FIELDS = "id,name,status,objective";
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

// ── Cursor-paged fetcher ──────────────────────────────────────────────────────

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

// ── KV key helpers ────────────────────────────────────────────────────────────

const KEY_CAMPAIGNS = "meta:campaigns";
const keyAds = (campaignId: string) => `meta:ads:${campaignId}`;

// ── Fetch from Meta + store in KV ─────────────────────────────────────────────

async function fetchCampaigns(accountId: string, token: string, businessId: string) {
  const es = encodeURIComponent(JSON.stringify(["ACTIVE"]));
  const campaigns = await fetchPaged<MetaCampaign>(
    `${GRAPH_URL}/act_${accountId}/campaigns?effective_status=${es}&fields=${CAMPAIGN_FIELDS}&limit=500&access_token=${token}`,
  );
  const data = { campaigns, cachedAt: Date.now(), accountId, businessId };
  await kvSet(KEY_CAMPAIGNS, data);
  return data;
}

function groupByAdSet(ads: MetaAd[]): Record<string, AdsByAdSet> {
  const out: Record<string, AdsByAdSet> = {};
  for (const ad of ads) {
    const { campaign: _c, ...adset } = ad.adset;
    if (!out[adset.id]) out[adset.id] = { adset, ads: [] };
    out[adset.id].ads.push(ad);
  }
  return out;
}

async function fetchCampaignAds(accountId: string, token: string, campaignId: string) {
  const es = encodeURIComponent(JSON.stringify(["ACTIVE"]));
  const filter = encodeURIComponent(
    JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: campaignId }]),
  );
  for (const limit of [100, 50]) {
    try {
      const ads = await fetchPaged<MetaAd>(
        `${GRAPH_URL}/act_${accountId}/ads?effective_status=${es}&filtering=${filter}&fields=${AD_FIELDS}&limit=${limit}&access_token=${token}`,
      );
      const data = { adsets: groupByAdSet(ads), adCount: ads.length, cachedAt: Date.now() };
      await kvSet(keyAds(campaignId), data);
      return data;
    } catch (err) {
      if (err instanceof OverloadError && limit > 50) continue;
      throw err;
    }
  }
  throw new Error("Meta API rejected request. Try again later.");
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ needsAuth: true }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get("campaignId");
  const forceRefresh = searchParams.get("refresh") === "true";

  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!accountId) return NextResponse.json({ error: "META_AD_ACCOUNT_ID not set" }, { status: 500 });

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "META_ACCESS_TOKEN not set. Add your System User token to Vercel environment variables." },
      { status: 500 },
    );
  }

  const businessId = process.env.META_BUSINESS_ID ?? "";

  try {
    if (campaignId) {
      // Try KV first unless force-refreshing
      if (!forceRefresh) {
        const cached = await kvGet<{ adsets: Record<string, AdsByAdSet>; adCount: number; cachedAt: number }>(keyAds(campaignId));
        if (cached) return NextResponse.json({ ...cached, accountId, businessId });
      }
      const data = await fetchCampaignAds(accountId, token, campaignId);
      return NextResponse.json({ ...data, accountId, businessId });
    }

    // Campaign list
    if (!forceRefresh) {
      const cached = await kvGet<{ campaigns: MetaCampaign[]; cachedAt: number; accountId: string; businessId: string }>(KEY_CAMPAIGNS);
      if (cached) return NextResponse.json(cached);
    }
    const data = await fetchCampaigns(accountId, token, businessId);
    return NextResponse.json(data);
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

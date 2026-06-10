import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getValidToken, readTokenFile, tokenExpiresIn } from "@/lib/token";
import type { MetaAd, GroupedAds } from "@/types/meta";

const GRAPH_URL = "https://graph.facebook.com/v21.0";
const FIELDS =
  "id,name,status,creative{id,name,object_type,thumbnail_url,image_url},adset{id,name,status,daily_budget,campaign{id,name,status,objective}}";

const CACHE_FILE = process.env.VERCEL
  ? "/tmp/meta-ads-cache.json"
  : path.join(process.cwd(), ".cache", "ads.json");
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

type CachePayload = GroupedAds & { cachedAt: number };

function readDiskCache(): CachePayload | null {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")) as CachePayload;
  } catch {
    return null;
  }
}

function writeDiskCache(payload: CachePayload) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(payload));
  } catch { /* non-fatal */ }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchAllAds(accountId: string, token: string): Promise<MetaAd[]> {
  const allAds: MetaAd[] = [];
  const effectiveStatus = encodeURIComponent(JSON.stringify(["ACTIVE"]));
  let url: string | null =
    `${GRAPH_URL}/act_${accountId}/ads?effective_status=${effectiveStatus}&fields=${FIELDS}&limit=100&access_token=${token}`;
  let page = 0;

  while (url) {
    if (page > 0) await sleep(800);
    page++;

    const res: Response = await fetch(url, { cache: "no-store" });

    const usage = res.headers.get("x-business-use-case-usage");
    if (usage) {
      try {
        const parsed = JSON.parse(usage) as Record<string, { call_count: number }[]>;
        const entry = Object.values(parsed)[0]?.[0];
        if (entry && entry.call_count >= 75) await sleep(5000);
      } catch { /* ignore */ }
    }

    const data: {
      data?: MetaAd[];
      error?: { message: string; code?: number };
      paging?: { next?: string };
    } = await res.json();

    if (data.error) throw new Error(data.error.message);

    allAds.push(...(data.data ?? []));
    url = data.paging?.next ?? null;
  }

  return allAds;
}

function groupAds(ads: MetaAd[]): GroupedAds {
  const campaigns: GroupedAds["campaigns"] = {};

  for (const ad of ads) {
    const { campaign, ...adsetWithoutCampaign } = ad.adset;
    const cId = campaign.id;
    const aId = adsetWithoutCampaign.id;

    if (!campaigns[cId]) campaigns[cId] = { campaign, adsets: {}, adCount: 0 };
    if (!campaigns[cId].adsets[aId])
      campaigns[cId].adsets[aId] = { adset: adsetWithoutCampaign, ads: [] };

    campaigns[cId].adsets[aId].ads.push(ad);
    campaigns[cId].adCount++;
  }

  const totalAdSets = Object.values(campaigns).reduce(
    (n, c) => n + Object.keys(c.adsets).length,
    0,
  );

  return {
    campaigns,
    totalAds: ads.length,
    totalCampaigns: Object.keys(campaigns).length,
    totalAdSets,
  };
}

export async function GET(request: Request) {
  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!accountId) {
    return NextResponse.json(
      { error: "META_AD_ACCOUNT_ID must be set in .env.local" },
      { status: 500 },
    );
  }

  // Check for valid OAuth token
  const token = getValidToken();
  if (!token) {
    return NextResponse.json({ needsAuth: true }, { status: 401 });
  }

  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "true";
  const now = Date.now();
  const disk = readDiskCache();

  const meta = { accountId, tokenExpiresIn: readTokenFile() ? tokenExpiresIn(readTokenFile()!) : null };

  // Serve fresh cache if within TTL
  if (disk && !forceRefresh && now - disk.cachedAt < CACHE_TTL_MS) {
    return NextResponse.json({ ...disk, ...meta });
  }

  try {
    const ads = await fetchAllAds(accountId, token);
    const payload: CachePayload = { ...groupAds(ads), cachedAt: now };
    writeDiskCache(payload);
    return NextResponse.json({ ...payload, ...meta });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const isRateLimit =
      message.toLowerCase().includes("too many calls") ||
      message.toLowerCase().includes("rate limit");

    if (isRateLimit && disk) {
      const ageMin = Math.round((now - disk.cachedAt) / 60000);
      return NextResponse.json({
        ...disk,
        warning: `Meta rate limit hit — showing cached data from ${ageMin} minute${ageMin !== 1 ? "s" : ""} ago. Auto-retries in 2 hrs.`,
      });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { MetaAd } from "@/types/meta";
import type { CampaignWithAds } from "@/app/api/ads/route";

// ─── Types ────────────────────────────────────────────────────────────────────

// ─── Helpers ──────────────────────────────────────────────────────────────────

function adsManagerUrl(
  type: "campaign" | "adset" | "ad",
  id: string,
  accountId: string,
  ctx?: { campaignId?: string; adsetId?: string; businessId?: string },
) {
  const base = "https://adsmanager.facebook.com/adsmanager/manage";
  const biz = ctx?.businessId ? `&business_id=${ctx.businessId}` : "";
  const nav = "&nav_source=no_referrer";
  switch (type) {
    case "campaign": {
      const f = `CAMPAIGN_SELECTED-STRING_SET%1EIN%1E[%22${id}%22]`;
      return `${base}/adsets?act=${accountId}${biz}&filter_set=${f}&selected_campaign_ids=${id}${nav}`;
    }
    case "adset": {
      const f = `ADSET_SELECTED-STRING_SET%1EIN%1E[%22${id}%22]`;
      return `${base}/ads?act=${accountId}${biz}&filter_set=${f}&selected_campaign_ids=${ctx?.campaignId ?? ""}&selected_adset_ids=${id}${nav}`;
    }
    case "ad": {
      const f = `ADGROUP_SELECTED-STRING_SET%1EIN%1E[%22${id}%22]`;
      return `${base}/ads?act=${accountId}${biz}&filter_set=${f}&selected_campaign_ids=${ctx?.campaignId ?? ""}&selected_adset_ids=${ctx?.adsetId ?? ""}&selected_ad_ids=${id}${nav}`;
    }
  }
}

function ExternalLink({ href, label }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={label ?? "Open in Ads Manager"}
      className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 font-medium shrink-0 transition"
    >
      {label && <span>{label}</span>}
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = status?.toUpperCase();
  const colors =
    s === "ACTIVE" ? "bg-green-100 text-green-700"
    : s === "PAUSED" ? "bg-yellow-100 text-yellow-700"
    : "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${colors}`}>
      {s === "ACTIVE" && <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />}
      {status}
    </span>
  );
}

function formatBudget(raw?: string) {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : `$${(n / 100).toFixed(2)}/day`;
}

function objectiveLabel(obj: string) {
  const map: Record<string, string> = {
    OUTCOME_LEADS: "Leads", OUTCOME_SALES: "Sales", OUTCOME_TRAFFIC: "Traffic",
    OUTCOME_AWARENESS: "Awareness", OUTCOME_ENGAGEMENT: "Engagement",
    OUTCOME_APP_PROMOTION: "App Promotion", LINK_CLICKS: "Link Clicks",
    CONVERSIONS: "Conversions", BRAND_AWARENESS: "Brand Awareness",
    REACH: "Reach", VIDEO_VIEWS: "Video Views", LEAD_GENERATION: "Lead Generation",
    MESSAGES: "Messages",
  };
  return map[obj] ?? obj ?? "—";
}

function adTypeInfo(objectType?: string) {
  const t = objectType?.toUpperCase();
  const labels: Record<string, string> = {
    VIDEO: "Video", PHOTO: "Image", SHARE: "Link / Carousel",
    OFFER: "Offer", EVENT: "Event", LEAD_GENERATION: "Lead Form",
    MULTI_SHARE: "Carousel", TEMPLATE: "Dynamic", STORE_ITEM: "Catalog",
  };
  const colors: Record<string, string> = {
    VIDEO: "bg-purple-100 text-purple-700", PHOTO: "bg-blue-100 text-blue-700",
    SHARE: "bg-orange-100 text-orange-700", LEAD_GENERATION: "bg-teal-100 text-teal-700",
    OFFER: "bg-pink-100 text-pink-700",
  };
  return {
    label: labels[t ?? ""] ?? (objectType ?? "Unknown"),
    color: colors[t ?? ""] ?? "bg-gray-100 text-gray-600",
  };
}

// ─── Preview Modal ────────────────────────────────────────────────────────────

const FORMATS = [
  { key: "MOBILE_FEED_STANDARD", label: "Mobile Feed" },
  { key: "DESKTOP_FEED_STANDARD", label: "Desktop Feed" },
  { key: "INSTAGRAM_STANDARD", label: "Instagram Feed" },
  { key: "INSTAGRAM_STORY", label: "IG Story" },
  { key: "AUDIENCE_NETWORK_OUTSTREAM_VIDEO", label: "Audience Network" },
];

function PreviewModal({ ad, accountId, businessId, onClose }: {
  ad: MetaAd; accountId: string; businessId: string; onClose: () => void;
}) {
  const [format, setFormat] = useState("MOBILE_FEED_STANDARD");
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPreviewLoading(true); setPreviewError(null); setPreview(null);
    fetch(`/api/preview?adId=${ad.id}&format=${format}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) setPreviewError(d.error); else setPreview(d.preview); })
      .catch(() => setPreviewError("Failed to load preview"))
      .finally(() => setPreviewLoading(false));
  }, [ad.id, format]);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[92vh] overflow-hidden">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0">
            <p className="text-xs text-gray-400 mb-0.5">Ad Preview</p>
            <h2 className="font-semibold text-gray-900 truncate text-sm">{ad.name}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center shrink-0 transition">
            <svg className="w-3.5 h-3.5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex gap-1.5 px-4 py-2.5 border-b border-gray-100 overflow-x-auto shrink-0">
          {FORMATS.map((f) => (
            <button key={f.key} onClick={() => setFormat(f.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition ${format === f.key ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center">
          {previewLoading && (
            <div className="w-full h-64 bg-gray-100 rounded-xl animate-pulse flex items-center justify-center">
              <p className="text-xs text-gray-400">Loading preview…</p>
            </div>
          )}
          {previewError && !previewLoading && (
            <div className="w-full p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{previewError}</div>
          )}
          {preview && !previewLoading && (
            <div className="w-full flex justify-center [&_iframe]:rounded-xl [&_iframe]:border-0 [&_iframe]:max-w-full"
              dangerouslySetInnerHTML={{ __html: preview }} />
          )}
        </div>
        <div className="border-t border-gray-100 p-4 space-y-2.5 shrink-0 bg-gray-50">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-gray-400">Campaign</p>
              <p className="text-sm font-medium text-gray-800 truncate">{ad.adset.campaign.name}</p>
            </div>
            <ExternalLink href={adsManagerUrl("campaign", ad.adset.campaign.id, accountId, { businessId })} label="Open" />
          </div>
          <div className="border-t border-gray-200" />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-gray-400">Ad Set</p>
              <p className="text-sm font-medium text-gray-800 truncate">{ad.adset.name}</p>
            </div>
            <ExternalLink href={adsManagerUrl("adset", ad.adset.id, accountId, { campaignId: ad.adset.campaign.id, businessId })} label="Open" />
          </div>
          <div className="border-t border-gray-200" />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-gray-400">Ad</p>
              <p className="text-sm font-medium text-gray-800 truncate">{ad.name}</p>
            </div>
            <ExternalLink href={adsManagerUrl("ad", ad.id, accountId, { campaignId: ad.adset.campaign.id, adsetId: ad.adset.id, businessId })} label="Open" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Ad Card ──────────────────────────────────────────────────────────────────

function AdCard({ ad, accountId, businessId, onPreview }: {
  ad: MetaAd; accountId: string; businessId: string; onPreview: (ad: MetaAd) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const type = adTypeInfo(ad.creative?.object_type);
  const rawUrl = ad.creative?.image_url || ad.creative?.thumbnail_url;
  const thumbnailUrl = rawUrl
    ? rawUrl.replace(/\/[sp]\d+x\d+\//, "/p600x600/").replace(/_s\.jpg/, "_n.jpg")
    : undefined;

  const insight = ad.insights?.data?.[0];
  const spend = insight?.spend ? `$${parseFloat(insight.spend).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
  const linkClicks = (
    insight?.actions?.find((a) => a.action_type === "link_click") ??
    insight?.actions?.find((a) => a.action_type === "outbound_click")
  )?.value ?? null;
  const formattedClicks = linkClicks ? parseInt(linkClicks, 10).toLocaleString("en-US") : null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col hover:shadow-md transition-shadow">
      <button
        className="relative bg-gray-100 aspect-video overflow-hidden group cursor-pointer w-full text-left"
        onClick={() => onPreview(ad)} title="Click to preview"
      >
        {thumbnailUrl && !imgError ? (
          <img src={thumbnailUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" onError={() => setImgError(true)} />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-300">
            {ad.creative?.object_type === "VIDEO" ? (
              <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm12.553 1.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
              </svg>
            ) : (
              <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
              </svg>
            )}
            <span className="text-[10px]">No preview</span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition flex items-center justify-center">
          <span className="opacity-0 group-hover:opacity-100 transition bg-white/90 text-gray-800 text-[10px] font-medium px-2 py-1 rounded-full shadow">Preview</span>
        </div>
        {ad.creative?.object_type && (
          <span className={`absolute top-1.5 left-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${type.color}`}>{type.label}</span>
        )}
        <span className="absolute top-1.5 right-1.5"><StatusBadge status={ad.status} /></span>
      </button>
      <div className="p-2 flex flex-col flex-1 gap-1.5">
        <div>
          <p className="text-[11px] font-medium text-gray-900 line-clamp-2 leading-snug">{ad.name}</p>
          <p className="text-[10px] text-gray-400 font-mono mt-0.5 truncate">ID: {ad.id}</p>
        </div>
        <div className="mt-auto pt-1.5 border-t border-gray-100 flex items-center gap-1.5">
          <div className="flex-1 flex items-center gap-1 min-w-0">
            {spend ? (
              <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                {spend}
              </span>
            ) : (
              <span className="text-[10px] text-gray-300">—</span>
            )}
            {formattedClicks && (
              <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                {formattedClicks} clicks
              </span>
            )}
          </div>
          <a
            href={adsManagerUrl("ad", ad.id, accountId, { campaignId: ad.adset.campaign.id, adsetId: ad.adset.id, businessId })}
            target="_blank" rel="noreferrer" title="Open ad in Ads Manager"
            className="flex items-center justify-center px-2 py-1 rounded-md bg-gray-100 hover:bg-blue-50 hover:text-blue-600 text-gray-500 transition shrink-0"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [campaigns, setCampaigns] = useState<CampaignWithAds[]>([]);
  const [accountId, setAccountId] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rateLimitMinutes, setRateLimitMinutes] = useState<number | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [tokenExpiresIn, setTokenExpiresIn] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [cachedAt, setCachedAt] = useState<Date | null>(null);
  const [previewAd, setPreviewAd] = useState<MetaAd | null>(null);

  // ── Single fetch: all campaigns + all ads + all insights ──────────────────
  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    setRateLimitMinutes(null);
    setNeedsAuth(false);
    setCampaigns([]);
    setExpanded({});

    try {
      const res = await fetch(forceRefresh ? "/api/ads?refresh=true" : "/api/ads");
      let json: Record<string, unknown>;
      try { json = await res.json(); }
      catch {
        throw new Error(res.status === 504 || res.status === 502
          ? "Request timed out. Click Retry."
          : `Server error (${res.status}). Click Retry.`);
      }
      if (json.needsAuth) { setNeedsAuth(true); return; }
      if (res.status === 429 || json.rateLimitResetMinutes != null) {
        setRateLimitMinutes((json.rateLimitResetMinutes as number) ?? 5);
        return;
      }
      if (json.error) throw new Error(json.error as string);

      const list = (json.campaigns as CampaignWithAds[]) ?? [];
      setCampaigns(list);
      setAccountId((json.accountId as string) ?? "");
      setBusinessId((json.businessId as string) ?? "");
      setTokenExpiresIn((json.tokenExpiresIn as string | null) ?? null);
      setCachedAt(json.cachedAt ? new Date(json.cachedAt as number) : new Date());

      // All campaigns arrive fully loaded — auto-expand all
      const exp: Record<string, boolean> = {};
      list.forEach((c) => { exp[c.campaign.id] = true; });
      setExpanded(exp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    const ae = new URLSearchParams(window.location.search).get("auth_error");
    if (ae) { setAuthError(decodeURIComponent(ae)); window.history.replaceState({}, "", "/"); }
  }, []);

  const toggleCampaign = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // ── Computed totals ────────────────────────────────────────────────────────
  const totalAds = campaigns.reduce((n, c) => n + c.adCount, 0);
  const totalAdSets = campaigns.reduce((n, c) => n + Object.keys(c.adsets).length, 0);

  // ── Search ─────────────────────────────────────────────────────────────────
  const q = search.toLowerCase();
  const filteredCampaigns = campaigns.filter(({ campaign, adsets }) => {
    if (!q) return true;
    if (campaign.name.toLowerCase().includes(q)) return true;
    return Object.values(adsets).some(
      (a) => a.adset.name.toLowerCase().includes(q) ||
        a.ads.some((ad) => ad.name.toLowerCase().includes(q)),
    );
  });

  // ── Connect screen ─────────────────────────────────────────────────────────
  if (!loading && needsAuth) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 w-full max-w-md text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg">
              <svg className="w-9 h-9 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </div>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Meta Ads Dashboard</h1>
            <p className="text-gray-500 text-sm mt-1">Connect your Facebook account to view all active ads, creatives, campaigns and ad sets.</p>
          </div>
          {authError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 text-left">
              <strong>Authentication failed:</strong> {authError}
            </div>
          )}
          <a href="/api/auth/login" className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            Connect with Facebook
          </a>
          <p className="text-xs text-gray-400">Token lasts ~60 days · no password stored</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {previewAd && (
        <PreviewModal ad={previewAd} accountId={accountId} businessId={businessId} onClose={() => setPreviewAd(null)} />
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Meta Ads Dashboard</h1>
              <p className="text-xs text-gray-500">Active ads · creatives overview</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {tokenExpiresIn && <span className="text-xs text-gray-400 hidden sm:block">Token expires in {tokenExpiresIn}</span>}
            {cachedAt && <span className="text-xs text-gray-400 hidden md:block">· data from {cachedAt.toLocaleTimeString()}</span>}
            <button
              onClick={() => load(true)} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition"
            >
              <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
            <a href="/api/auth/logout" className="text-xs text-gray-400 hover:text-red-500 transition hidden sm:block">Disconnect</a>
          </div>
        </div>

      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Rate limit banner */}
        {rateLimitMinutes != null && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <p className="font-medium text-orange-800 text-sm">Meta API rate limit reached</p>
              <p className="text-orange-700 text-sm mt-0.5">Resets in ~<strong>{rateLimitMinutes} min</strong>. Please wait then click Refresh.</p>
            </div>
            <button onClick={() => load(false)} disabled={loading}
              className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-orange-100 hover:bg-orange-200 text-orange-800 disabled:opacity-50 transition">
              Retry
            </button>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-red-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <p className="font-medium text-red-800 text-sm">Failed to load ads</p>
              <p className="text-red-600 text-sm mt-0.5">{error}</p>
            </div>
            <button onClick={() => load(true)} disabled={loading}
              className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-800 disabled:opacity-50 transition">
              {loading ? "Retrying…" : "Retry"}
            </button>
          </div>
        )}

        {/* Initial loading skeleton */}
        {loading && (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
                <div className="h-3 bg-gray-200 rounded w-1/3 mb-3" />
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                  {[1, 2, 3, 4, 5, 6].map((j) => (
                    <div key={j} className="rounded-lg overflow-hidden border border-gray-100">
                      <div className="aspect-video bg-gray-200" />
                      <div className="p-2 space-y-1.5">
                        <div className="h-2.5 bg-gray-200 rounded w-3/4" />
                        <div className="h-2 bg-gray-100 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && campaigns.length > 0 && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Active Ads", value: totalAds, color: "text-blue-600" },
                { label: "Campaigns", value: campaigns.length, color: "text-purple-600" },
                { label: "Ad Sets", value: totalAdSets, color: "text-indigo-600" },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className={`text-2xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text" placeholder="Search campaigns, ad sets, or ads..."
                value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {filteredCampaigns.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-gray-400 text-sm">No active ads found{search ? " matching your search" : ""}.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredCampaigns.map(({ campaign, adsets, adCount }) => {
                  const isOpen = expanded[campaign.id] ?? true;
                  const adsetList = Object.values(adsets).filter((a) => {
                    if (!q) return true;
                    return (
                      campaign.name.toLowerCase().includes(q) ||
                      a.adset.name.toLowerCase().includes(q) ||
                      a.ads.some((ad) => ad.name.toLowerCase().includes(q))
                    );
                  });

                  return (
                    <div key={campaign.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      {/* Campaign header */}
                      <div className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition">
                        <button
                          className="flex items-center gap-2 min-w-0 flex-1 text-left"
                          onClick={() => toggleCampaign(campaign.id)}
                        >
                          <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${isOpen ? "bg-blue-100" : "bg-gray-100"}`}>
                            <svg className={`w-3.5 h-3.5 ${isOpen ? "text-blue-600" : "text-gray-500"}`} fill="currentColor" viewBox="0 0 20 20">
                              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-gray-900 truncate">{campaign.name}</p>
                            <p className="text-[10px] text-gray-500 mt-0.5">
                              {objectiveLabel(campaign.objective)} · {Object.keys(adsets).length} ad set{Object.keys(adsets).length !== 1 ? "s" : ""} · {adCount} ad{adCount !== 1 ? "s" : ""}
                            </p>
                          </div>
                        </button>
                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          <StatusBadge status={campaign.status} />
                          <ExternalLink href={adsManagerUrl("campaign", campaign.id, accountId, { businessId })} />
                          <svg
                            className={`w-3.5 h-3.5 text-gray-400 transition-transform cursor-pointer ${isOpen ? "rotate-180" : ""}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            onClick={() => toggleCampaign(campaign.id)}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>

                      {/* Campaign body */}
                      {isOpen && (
                        <div className="border-t border-gray-100 divide-y divide-gray-100">
                          {adsetList.map((adsetData) => {
                            const visibleAds = adsetData.ads.filter((ad) => {
                              if (!q) return true;
                              return (
                                campaign.name.toLowerCase().includes(q) ||
                                adsetData.adset.name.toLowerCase().includes(q) ||
                                ad.name.toLowerCase().includes(q)
                              );
                            });
                            const budget = formatBudget(adsetData.adset.daily_budget);
                            return (
                              <div key={adsetData.adset.id}>
                                <div className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-50">
                                  <div className="w-4 h-4 rounded bg-indigo-100 flex items-center justify-center shrink-0">
                                    <svg className="w-2.5 h-2.5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                                      <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
                                    </svg>
                                  </div>
                                  <span className="text-[11px] font-medium text-gray-700 flex-1 truncate">{adsetData.adset.name}</span>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {budget && <span className="text-[10px] text-gray-500">{budget}</span>}
                                    <StatusBadge status={adsetData.adset.status} />
                                    <ExternalLink href={adsManagerUrl("adset", adsetData.adset.id, accountId, { campaignId: campaign.id, businessId })} />
                                  </div>
                                </div>
                                <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                                  {visibleAds.map((ad) => (
                                    <AdCard
                                      key={ad.id}
                                      ad={ad}
                                      accountId={accountId}
                                      businessId={businessId}
                                      onPreview={setPreviewAd}
                                    />
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

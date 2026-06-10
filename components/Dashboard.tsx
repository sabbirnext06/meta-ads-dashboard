"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { GroupedAds, MetaAd } from "@/types/meta";

// ─── helpers ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = status?.toUpperCase();
  const colors =
    s === "ACTIVE"
      ? "bg-green-100 text-green-700"
      : s === "PAUSED"
        ? "bg-yellow-100 text-yellow-700"
        : "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors}`}>
      {s === "ACTIVE" && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
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
    OUTCOME_LEADS: "Leads",
    OUTCOME_SALES: "Sales",
    OUTCOME_TRAFFIC: "Traffic",
    OUTCOME_AWARENESS: "Awareness",
    OUTCOME_ENGAGEMENT: "Engagement",
    OUTCOME_APP_PROMOTION: "App Promotion",
    LINK_CLICKS: "Link Clicks",
    CONVERSIONS: "Conversions",
    BRAND_AWARENESS: "Brand Awareness",
    REACH: "Reach",
    VIDEO_VIEWS: "Video Views",
    LEAD_GENERATION: "Lead Generation",
    MESSAGES: "Messages",
  };
  return map[obj] ?? obj ?? "—";
}

function adTypeInfo(objectType?: string): { label: string; color: string; icon: React.ReactNode } {
  const t = objectType?.toUpperCase();
  const icons: Record<string, React.ReactNode> = {
    VIDEO: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm12.553 1.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
      </svg>
    ),
    PHOTO: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
      </svg>
    ),
    SHARE: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
        <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
      </svg>
    ),
    LEAD_GENERATION: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
        <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
      </svg>
    ),
  };
  const labels: Record<string, string> = {
    VIDEO: "Video",
    PHOTO: "Image",
    SHARE: "Link / Carousel",
    OFFER: "Offer",
    EVENT: "Event",
    DOMAIN: "Domain",
    STORE_ITEM: "Catalog",
    LEAD_GENERATION: "Lead Form",
    MULTI_SHARE: "Carousel",
    TEMPLATE: "Dynamic",
  };
  const colors: Record<string, string> = {
    VIDEO: "bg-purple-100 text-purple-700",
    PHOTO: "bg-blue-100 text-blue-700",
    SHARE: "bg-orange-100 text-orange-700",
    LEAD_GENERATION: "bg-teal-100 text-teal-700",
    OFFER: "bg-pink-100 text-pink-700",
    EVENT: "bg-yellow-100 text-yellow-700",
  };
  return {
    label: labels[t ?? ""] ?? (objectType ?? "Unknown"),
    color: colors[t ?? ""] ?? "bg-gray-100 text-gray-600",
    icon: icons[t ?? ""] ?? (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
      </svg>
    ),
  };
}

// ─── AdCard ─────────────────────────────────────────────────────────────────

function AdCard({ ad }: { ad: MetaAd }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);
  const type = adTypeInfo(ad.creative?.object_type);
  const thumbnailUrl = ad.creative?.thumbnail_url || ad.creative?.image_url;

  useEffect(() => {
    if (!infoOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) {
        setInfoOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [infoOpen]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col hover:shadow-md transition-shadow">
      {/* Thumbnail */}
      <div className="relative bg-gray-100 aspect-video overflow-hidden">
        {thumbnailUrl && !imgError ? (
          <img
            src={thumbnailUrl}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-300">
            {ad.creative?.object_type === "VIDEO" ? (
              <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm12.553 1.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
              </svg>
            ) : (
              <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
              </svg>
            )}
            <span className="text-xs text-gray-400">No preview</span>
          </div>
        )}

        {/* Type badge — top-left overlay */}
        {ad.creative?.object_type && (
          <span className={`absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium backdrop-blur-sm ${type.color}`}>
            {type.icon}
            {type.label}
          </span>
        )}

        {/* Status — top-right overlay */}
        <span className="absolute top-2 right-2">
          <StatusBadge status={ad.status} />
        </span>
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col flex-1 gap-2">
        <div>
          <p className="text-sm font-medium text-gray-900 line-clamp-2 leading-snug">{ad.name}</p>
          <p className="text-xs text-gray-400 font-mono mt-0.5">ID: {ad.id}</p>
        </div>

        {/* Info button */}
        <div className="mt-auto pt-2 border-t border-gray-100 relative" ref={infoRef}>
          <button
            onClick={() => setInfoOpen((v) => !v)}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg w-full justify-center transition ${
              infoOpen
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            Campaign & Ad Set Info
          </button>

          {infoOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-2 z-20 bg-white border border-gray-200 rounded-xl shadow-xl p-4 space-y-3">
              {/* Campaign */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-5 h-5 rounded bg-blue-100 flex items-center justify-center">
                    <svg className="w-3 h-3 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                  </div>
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Campaign</span>
                </div>
                <p className="text-sm font-medium text-gray-800 leading-snug pl-6">
                  {ad.adset.campaign.name}
                </p>
                <p className="text-xs text-gray-400 font-mono pl-6 mt-0.5">{ad.adset.campaign.id}</p>
              </div>

              <div className="border-t border-gray-100" />

              {/* Ad Set */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-5 h-5 rounded bg-indigo-100 flex items-center justify-center">
                    <svg className="w-3 h-3 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
                    </svg>
                  </div>
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Ad Set</span>
                </div>
                <p className="text-sm font-medium text-gray-800 leading-snug pl-6">
                  {ad.adset.name}
                </p>
                <p className="text-xs text-gray-400 font-mono pl-6 mt-0.5">{ad.adset.id}</p>
              </div>

              {/* Objective chip */}
              <div className="border-t border-gray-100 pt-2 flex items-center justify-between">
                <span className="text-xs text-gray-400">Objective</span>
                <span className="text-xs font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full">
                  {objectiveLabel(ad.adset.campaign.objective)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData] = useState<GroupedAds | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [tokenExpiresIn, setTokenExpiresIn] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [cachedAt, setCachedAt] = useState<Date | null>(null);

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    setWarning(null);
    setNeedsAuth(false);
    try {
      const url = forceRefresh ? "/api/ads?refresh=true" : "/api/ads";
      const res = await fetch(url);
      const json = await res.json();
      if (json.needsAuth) { setNeedsAuth(true); return; }
      if (json.error) throw new Error(json.error);
      if (json.warning) setWarning(json.warning);
      setData(json);
      if (json.tokenExpiresIn) setTokenExpiresIn(json.tokenExpiresIn);
      setCachedAt(json.cachedAt ? new Date(json.cachedAt) : new Date());
      const allOpen: Record<string, boolean> = {};
      Object.keys(json.campaigns ?? {}).forEach((id) => (allOpen[id] = true));
      setExpanded(allOpen);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  // Read ?auth_error from URL on first load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ae = params.get("auth_error");
    if (ae) {
      setAuthError(decodeURIComponent(ae));
      window.history.replaceState({}, "", "/");
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const toggleCampaign = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const q = search.toLowerCase();

  const filteredCampaigns = data
    ? Object.entries(data.campaigns).filter(([, c]) => {
        if (!q) return true;
        return (
          c.campaign.name.toLowerCase().includes(q) ||
          Object.values(c.adsets).some(
            (a) =>
              a.adset.name.toLowerCase().includes(q) ||
              a.ads.some((ad) => ad.name.toLowerCase().includes(q)),
          )
        );
      })
    : [];

  // ── Connect screen ────────────────────────────────────────────────────────
  if (!loading && needsAuth) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 w-full max-w-md text-center space-y-6">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg">
              <svg className="w-9 h-9 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </div>
          </div>

          <div>
            <h1 className="text-xl font-bold text-gray-900">Meta Ads Dashboard</h1>
            <p className="text-gray-500 text-sm mt-1">
              Connect your Facebook account to view all active ads, creatives, campaigns, and ad sets.
            </p>
          </div>

          {authError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 text-left">
              <strong>Authentication failed:</strong> {authError}
            </div>
          )}

          <a
            href="/api/auth/login"
            className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            Connect with Facebook
          </a>

          <div className="text-xs text-gray-400 space-y-1 border-t border-gray-100 pt-4">
            <p>Requires <code className="bg-gray-100 px-1 rounded">ads_read</code> permission</p>
            <p>Token lasts ~60 days · no password stored</p>
          </div>
        </div>

        <p className="mt-6 text-xs text-gray-400 max-w-sm text-center">
          Make sure <code className="bg-white border border-gray-200 px-1 rounded">http://localhost:3000/api/auth/callback</code> is added as a Valid OAuth Redirect URI in your Meta App settings.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
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
            {tokenExpiresIn && (
              <span className="text-xs text-gray-400 hidden sm:block">
                Token expires in {tokenExpiresIn}
              </span>
            )}
            {cachedAt && (
              <span className="text-xs text-gray-400 hidden md:block">
                · data from {cachedAt.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={() => load(true)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition"
            >
              <svg
                className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
            <a
              href="/api/auth/logout"
              className="text-xs text-gray-400 hover:text-red-500 transition hidden sm:block"
              title="Disconnect Facebook account"
            >
              Disconnect
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Rate-limit warning (stale cache served) */}
        {warning && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <p className="text-sm text-yellow-800">{warning}</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-red-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-medium text-red-800 text-sm">Failed to load ads</p>
              <p className="text-red-600 text-sm mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Skeleton */}
        {loading && !data && (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="rounded-xl overflow-hidden border border-gray-100">
                      <div className="aspect-video bg-gray-200" />
                      <div className="p-3 space-y-2">
                        <div className="h-3 bg-gray-200 rounded w-3/4" />
                        <div className="h-3 bg-gray-100 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {data && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Active Ads", value: data.totalAds, color: "text-blue-600" },
                { label: "Campaigns", value: data.totalCampaigns, color: "text-purple-600" },
                { label: "Ad Sets", value: data.totalAdSets, color: "text-indigo-600" },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">{s.label}</p>
                  <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search campaigns, ad sets, or ads..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Campaign groups */}
            {filteredCampaigns.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-gray-400 text-sm">No active ads found{search ? " matching your search" : ""}.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredCampaigns.map(([campaignId, campaignData]) => {
                  const isOpen = expanded[campaignId] ?? true;
                  const adsetList = Object.values(campaignData.adsets);

                  const visibleAdsets = adsetList.filter((a) => {
                    if (!q) return true;
                    return (
                      campaignData.campaign.name.toLowerCase().includes(q) ||
                      a.adset.name.toLowerCase().includes(q) ||
                      a.ads.some((ad) => ad.name.toLowerCase().includes(q))
                    );
                  });

                  return (
                    <div key={campaignId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      {/* Campaign header */}
                      <button
                        onClick={() => toggleCampaign(campaignId)}
                        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition text-left"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isOpen ? "bg-blue-100" : "bg-gray-100"}`}>
                            <svg className={`w-4 h-4 ${isOpen ? "text-blue-600" : "text-gray-500"}`} fill="currentColor" viewBox="0 0 20 20">
                              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 truncate">{campaignData.campaign.name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {objectiveLabel(campaignData.campaign.objective)} · {adsetList.length} ad set{adsetList.length !== 1 ? "s" : ""} · {campaignData.adCount} ad{campaignData.adCount !== 1 ? "s" : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-4">
                          <StatusBadge status={campaignData.campaign.status} />
                          <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </button>

                      {/* Ad sets */}
                      {isOpen && (
                        <div className="border-t border-gray-100 divide-y divide-gray-100">
                          {visibleAdsets.map((adsetData) => {
                            const visibleAds = adsetData.ads.filter((ad) => {
                              if (!q) return true;
                              return (
                                campaignData.campaign.name.toLowerCase().includes(q) ||
                                adsetData.adset.name.toLowerCase().includes(q) ||
                                ad.name.toLowerCase().includes(q)
                              );
                            });
                            const budget = formatBudget(adsetData.adset.daily_budget);

                            return (
                              <div key={adsetData.adset.id}>
                                {/* Ad set label */}
                                <div className="flex items-center gap-2 px-5 py-2.5 bg-gray-50">
                                  <div className="w-5 h-5 rounded bg-indigo-100 flex items-center justify-center shrink-0">
                                    <svg className="w-3 h-3 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                                      <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
                                    </svg>
                                  </div>
                                  <span className="text-sm font-medium text-gray-700 flex-1 truncate">{adsetData.adset.name}</span>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {budget && <span className="text-xs text-gray-500">{budget}</span>}
                                    <StatusBadge status={adsetData.adset.status} />
                                  </div>
                                </div>

                                {/* Ad cards grid */}
                                <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                  {visibleAds.map((ad) => (
                                    <AdCard key={ad.id} ad={ad} />
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

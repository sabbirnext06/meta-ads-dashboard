import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";

export async function GET(request: Request) {
  if (!checkAuth(request)) return NextResponse.json({ needsAuth: true }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const adId = searchParams.get("adId");
  const format = searchParams.get("format") || "MOBILE_FEED_STANDARD";

  if (!adId) return NextResponse.json({ error: "adId is required" }, { status: 400 });

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "META_ACCESS_TOKEN is not set. Add your System User token to Vercel environment variables." },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${adId}/previews?ad_format=${format}&access_token=${token}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (data.error) {
      const msg: string = data.error.message ?? "";
      if (msg.toLowerCase().includes("expired") || msg.toLowerCase().includes("session")) {
        return NextResponse.json(
          { error: "Access token expired. Go to Vercel → Settings → Environment Variables and update META_ACCESS_TOKEN with a new System User token (set expiration to Never)." },
          { status: 401 },
        );
      }
      throw new Error(msg);
    }
    return NextResponse.json({ preview: data.data?.[0]?.body ?? null });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch preview" },
      { status: 500 },
    );
  }
}

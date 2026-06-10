import { NextResponse } from "next/server";
import { getValidToken } from "@/lib/token";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const adId = searchParams.get("adId");
  const format = searchParams.get("format") || "MOBILE_FEED_STANDARD";

  const token = getValidToken();
  if (!token) return NextResponse.json({ needsAuth: true }, { status: 401 });
  if (!adId) return NextResponse.json({ error: "adId is required" }, { status: 400 });

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${adId}/previews?ad_format=${format}&access_token=${token}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return NextResponse.json({ preview: data.data?.[0]?.body ?? null });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch preview" },
      { status: 500 },
    );
  }
}

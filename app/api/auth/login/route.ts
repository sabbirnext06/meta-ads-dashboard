import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/url";

export async function GET() {
  const appId = process.env.META_APP_ID;
  if (!appId) {
    return NextResponse.json({ error: "META_APP_ID not set in environment" }, { status: 500 });
  }

  const redirectUri = encodeURIComponent(`${getBaseUrl()}/api/auth/callback`);
  const scope = "ads_read,ads_management";
  const authUrl =
    `https://www.facebook.com/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code`;

  return NextResponse.redirect(authUrl);
}

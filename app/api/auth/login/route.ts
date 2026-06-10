import { NextResponse } from "next/server";

export async function GET() {
  const appId = process.env.META_APP_ID;
  if (!appId) {
    return NextResponse.json({ error: "META_APP_ID not set in .env.local" }, { status: 500 });
  }

  const redirectUri = encodeURIComponent("http://localhost:3000/api/auth/callback");
  const scope = "ads_read,ads_management";
  const authUrl =
    `https://www.facebook.com/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code`;

  return NextResponse.redirect(authUrl);
}

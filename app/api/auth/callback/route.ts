import { NextResponse } from "next/server";
import { writeTokenFile } from "@/lib/token";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error_description") ?? searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(
      `http://localhost:3000/?auth_error=${encodeURIComponent(error ?? "Authorization cancelled")}`,
    );
  }

  const appId = process.env.META_APP_ID!;
  const appSecret = process.env.META_APP_SECRET!;
  const redirectUri = encodeURIComponent("http://localhost:3000/api/auth/callback");

  // 1. Exchange auth code for short-lived user token
  const shortRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&redirect_uri=${redirectUri}&client_secret=${appSecret}&code=${code}`,
  );
  const shortData = await shortRes.json();

  if (shortData.error) {
    return NextResponse.redirect(
      `http://localhost:3000/?auth_error=${encodeURIComponent(shortData.error.message)}`,
    );
  }

  // 2. Exchange short-lived token for long-lived token (~60 days)
  const longRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortData.access_token}`,
  );
  const longData = await longRes.json();

  const finalToken: string = longData.access_token ?? shortData.access_token;
  // expires_in is in seconds; long-lived tokens are ~5184000s (60 days)
  const expiresIn: number = longData.expires_in ?? shortData.expires_in ?? 3600;

  writeTokenFile({
    access_token: finalToken,
    expires_at: Date.now() + expiresIn * 1000,
    obtained_at: Date.now(),
  });

  return NextResponse.redirect("http://localhost:3000/");
}

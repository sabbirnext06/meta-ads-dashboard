import { NextResponse } from "next/server";
import { writeTokenFile, tokenCookieOptions } from "@/lib/token";
import { getBaseUrl } from "@/lib/url";

export async function GET(request: Request) {
  const base = getBaseUrl();
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error_description") ?? searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(
      `${base}/?auth_error=${encodeURIComponent(error ?? "Authorization cancelled")}`,
    );
  }

  const appId = process.env.META_APP_ID!;
  const appSecret = process.env.META_APP_SECRET!;
  const redirectUri = encodeURIComponent(`${base}/api/auth/callback`);

  // Exchange auth code for short-lived user token
  const shortRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&redirect_uri=${redirectUri}&client_secret=${appSecret}&code=${code}`,
  );
  const shortData = await shortRes.json();

  if (shortData.error) {
    return NextResponse.redirect(
      `${base}/?auth_error=${encodeURIComponent(shortData.error.message)}`,
    );
  }

  // Exchange for long-lived token (~60 days)
  const longRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortData.access_token}`,
  );
  const longData = await longRes.json();

  const finalToken: string = longData.access_token ?? shortData.access_token;
  const expiresIn: number = longData.expires_in ?? shortData.expires_in ?? 3600;

  const tokenData = {
    access_token: finalToken,
    expires_at: Date.now() + expiresIn * 1000,
    obtained_at: Date.now(),
  };

  // Local dev: write to file cache
  writeTokenFile(tokenData);

  // Vercel: store in HttpOnly cookie so it survives across serverless instances
  const response = NextResponse.redirect(`${base}/`);
  response.cookies.set("meta_token", JSON.stringify(tokenData), tokenCookieOptions(tokenData.expires_at));
  return response;
}

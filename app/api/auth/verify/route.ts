import { NextResponse } from "next/server";
import { makeSessionToken } from "@/lib/auth";

export async function POST(request: Request) {
  const password = process.env.DASHBOARD_PASSWORD;

  if (!password) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set("ds_auth", "open", { path: "/", maxAge: 60 * 60 * 24 * 365 });
    return res;
  }

  let body: { password?: string } = {};
  try { body = await request.json(); } catch { /* empty body */ }

  if (body.password !== password) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("ds_auth", makeSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}

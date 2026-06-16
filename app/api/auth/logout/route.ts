import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/url";

export async function GET() {
  const res = NextResponse.redirect(`${getBaseUrl()}/`);
  res.cookies.delete("ds_auth");
  res.cookies.delete("meta_token"); // clear old OAuth cookie too
  return res;
}

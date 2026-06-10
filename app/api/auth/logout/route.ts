import { NextResponse } from "next/server";
import { clearTokenFile } from "@/lib/token";
import { getBaseUrl } from "@/lib/url";

export async function GET() {
  clearTokenFile();
  const response = NextResponse.redirect(`${getBaseUrl()}/`);
  response.cookies.delete("meta_token");
  return response;
}

import { NextResponse } from "next/server";
import { clearTokenFile } from "@/lib/token";
import { getBaseUrl } from "@/lib/url";

export async function GET() {
  clearTokenFile();
  return NextResponse.redirect(`${getBaseUrl()}/`);
}

import { NextResponse } from "next/server";
import { clearTokenFile } from "@/lib/token";

export async function GET() {
  clearTokenFile();
  return NextResponse.redirect("http://localhost:3000/");
}

import { NextResponse } from "next/server";
import { sourceUrl } from "@/lib/source-url";

export function GET() {
  return NextResponse.redirect(sourceUrl(), 307);
}

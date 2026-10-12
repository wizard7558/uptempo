import { NextResponse } from "next/server";

const DEFAULT_SOURCE_URL = "https://github.com/wizard7558/uptempo";

export function GET() {
  const target = process.env.UPTEMPO_SOURCE_URL?.trim() || DEFAULT_SOURCE_URL;
  return NextResponse.redirect(target, 307);
}

import { NextResponse } from "next/server";
import { clearBookingSession } from "@/lib/booking/session-cookie";

export const dynamic = 'force-dynamic';

export async function POST() {
  await clearBookingSession();
  return NextResponse.json({ success: true });
}

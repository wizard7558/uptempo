import { NextResponse } from "next/server";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { createSetupIntent } from "@/actions/stripe";

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const clientId = await getBookingSession();
    if (!clientId) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 },
      );
    }

    const { clientSecret } = await createSetupIntent(clientId);
    return NextResponse.json({ clientSecret });
  } catch (error) {
    console.error("SetupIntent creation failed:", error);
    return NextResponse.json(
      { error: "Failed to create setup intent" },
      { status: 500 },
    );
  }
}

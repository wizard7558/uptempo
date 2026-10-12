import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getUptempoMode } from "@/lib/config/mode";
import { publicDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("db_timeout")), 3_000);
    });
    await Promise.race([publicDb.execute(sql`select 1`), timeout]);
    return NextResponse.json(
      {
        ok: true,
        mode: getUptempoMode(),
        version: process.env.UPTEMPO_VERSION ?? "dev",
        db: "ok",
      },
      { headers: noStore },
    );
  } catch {
    return NextResponse.json({ ok: false, db: "error" }, { status: 503, headers: noStore });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

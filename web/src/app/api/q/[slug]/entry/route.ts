import { eq } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { hasModule } from "@/lib/tenant/modules";
import { hashPublicToken, isPublicTokenShape } from "@/lib/security/public-token";
import { loadQueueBoard } from "@/lib/queue/board";
import { getBusinessBySlug } from "@/actions/booking-public";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const HEADERS = { "Cache-Control": "no-store" };

const notFound = () => Response.json({}, { status: 404, headers: HEADERS });

/**
 * One person's place in the walk-in line. The link token is the only credential:
 * it is looked up by hash, and any bad input gets the same empty 404. Not rate
 * limited (polling); the 192-bit token is what protects it.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  if (!SLUG_RE.test(slug) || !isPublicTokenShape(token)) return notFound();
  if (!(await hasModule(slug, "walk_in_queue"))) return notFound();

  const hash = hashPublicToken(token);
  const entry = await withTenantDb(slug, async (db, t) => {
    const [row] = await db
      .select({
        status: t.queueEntries.status,
        id: t.queueEntries.id,
        locationId: t.queueEntries.locationId,
      })
      .from(t.queueEntries)
      .where(eq(t.queueEntries.publicTokenHash, hash))
      .limit(1);
    return row;
  });
  if (!entry) return notFound();

  const [business, cachedBoard] = await Promise.all([
    getBusinessBySlug(slug),
    loadQueueBoard(slug, entry.locationId, new Date(), { cached: true }),
  ]);
  const isHere = (b: typeof cachedBoard) =>
    [...b.waiting, ...b.called, ...b.inService].some((e) => e.id === entry.id);
  // The 5 second copy can predate a join or a status change; reload once if it disagrees.
  const board =
    entry.status !== "done" && entry.status !== "left" && !isHere(cachedBoard)
      ? await loadQueueBoard(slug, entry.locationId)
      : cachedBoard;
  const waiting = board.waiting.find((w) => w.id === entry.id);
  const active = waiting ?? board.called.find((c) => c.id === entry.id) ?? board.inService.find((s) => s.id === entry.id);
  // The status in the table is the truth; the board only adds place and wait.
  return Response.json(
    {
      status: entry.status,
      position: waiting?.position ?? null,
      waitMinutes: waiting?.waitMinutes ?? null,
      staffName: active?.assignedStaffName ?? null,
      businessName: business?.name ?? "",
    },
    { headers: HEADERS },
  );
}

import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { getActiveStaffRole } from "@/lib/auth/rbac";
import { verifyFileLink } from "@/lib/storage/file-links";
import { getStorageProvider } from "@/lib/providers/storage";

export const dynamic = "force-dynamic";

/** Lifetime of the provider read URL we redirect to. The signed link itself lasts 5 minutes. */
const READ_URL_TTL_SECONDS = 60;
const STAFF_ROLES = ["owner", "admin", "provider"];
const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const noStore = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: noStore });

/**
 * Private attachment access. Verifies the signed link, loads the row from the
 * tenant schema, requires a staff session of that tenant for ID documents, and
 * then 302-redirects to a provider read URL that expires in 60 seconds.
 *
 * Redirect rather than stream: the storage provider interface has no read
 * method (only `getSignedReadUrl`), and fetching our own signed URL server side
 * would add a loopback request and a base-URL dependency. The only URL that
 * ever leaves this route is the 60 second one, issued after every check.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const url = new URL(request.url);

  if (!verifyFileLink(slug, id, url.searchParams.get("e"), url.searchParams.get("s"))) {
    return json({ error: "Link expired" }, 403);
  }
  if (!SLUG_RE.test(slug) || !UUID_RE.test(id)) return json({ error: "Not found" }, 404);

  const row = await withTenantDb(slug, async (db, t) => {
    const rows = await db
      .select({ kind: t.attachments.kind, storageKey: t.attachments.storageKey })
      .from(t.attachments)
      .where(and(eq(t.attachments.id, id), isNull(t.attachments.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  });
  if (!row) return json({ error: "Not found" }, 404);

  if (row.kind === "id_document") {
    const staff = await getActiveStaffRole();
    if (!staff || staff.tenantSlug !== slug || !STAFF_ROLES.includes(staff.role)) {
      return json({ error: "Forbidden" }, 403);
    }
  }

  let readUrl: string;
  try {
    readUrl = await getStorageProvider().getSignedReadUrl(row.storageKey, READ_URL_TTL_SECONDS);
  } catch {
    return json({ error: "File storage is not available" }, 503);
  }
  return new NextResponse(null, {
    status: 302,
    headers: { ...noStore, Location: readUrl, "X-Content-Type-Options": "nosniff" },
  });
}

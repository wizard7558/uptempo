import { requireRole } from "@/lib/auth/rbac";
import { requireModule } from "@/lib/tenant/modules";
import { getQueueBoard } from "@/actions/queue";
import { BoardClient } from "./board-client";

export default async function WalkInsPage() {
  const { role } = await requireRole("owner", "admin", "provider", "assistant");
  await requireModule("walk_in_queue");

  // With two or more locations the board starts on the first one, like the public page.
  const all = await getQueueBoard(null);
  const locationId = all.locations.length >= 2 ? all.locations[0].id : null;
  const initial = locationId ? await getQueueBoard(locationId) : all;

  return (
    <BoardClient
      initial={initial}
      initialLocationId={locationId}
      canManage={role === "owner" || role === "admin"}
    />
  );
}

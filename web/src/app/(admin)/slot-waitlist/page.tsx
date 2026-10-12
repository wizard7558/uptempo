import { requireRole } from "@/lib/auth/rbac";
import { requireModule } from "@/lib/tenant/modules";
import { getT } from "@/lib/terms/server";
import { listSlotWaitlist } from "@/actions/slot-waitlist";
import { WaitlistClient } from "./waitlist-client";

export default async function SlotWaitlistPage() {
  const { role } = await requireRole("owner", "admin", "provider", "assistant");
  await requireModule("slot_waitlist");
  const [data, t] = await Promise.all([listSlotWaitlist(), getT("waitlist")]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{t("admin.title")}</h1>
        <p className="text-muted-foreground">{t("admin.subtitle")}</p>
      </div>
      <WaitlistClient data={data} canManage={role === "owner" || role === "admin"} />
    </div>
  );
}

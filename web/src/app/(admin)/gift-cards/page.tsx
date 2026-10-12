import { requireRole } from "@/lib/auth/rbac";
import { requireModule } from "@/lib/tenant/modules";
import { listGiftCards } from "@/actions/gift-cards";
import { GiftCardsClient } from "./gift-cards-client";

export default async function GiftCardsPage() {
  await requireRole("owner", "admin");
  await requireModule("gift_cards");
  const initial = await listGiftCards({});
  return <GiftCardsClient initial={initial} />;
}

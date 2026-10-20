import { getT } from "@/lib/terms/server";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AccountPageSkeleton } from "@/components/booking-public/page-skeletons";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { getTenantSlugOrNull } from "@/lib/tenant/context";
import {
  getTenantBySlug,
  getTenantSlugForBookingClient,
} from "@/lib/tenant/registry";
import { getClientProfile, getClientAppointments } from "@/actions/client-profile";
import {
  getClientStoredValuePublic,
  listActiveMembershipPlansPublic,
} from "@/actions/membership";
import { getSmsConsentForBookingClient } from "@/actions/sms";
import { getBusinessSettingsForTenant } from "@/lib/policies/business-policy";
import { AccountHub } from "@/components/booking-public/account-hub";

export default function AccountPage() {
  // Flush the shell immediately; account data streams in behind the skeleton
  // (this is the native app's Account tab).
  return (
    <Suspense fallback={<AccountPageSkeleton />}>
      <AccountPageContent />
    </Suspense>
  );
}

async function AccountPageContent() {
  const clientId = await getBookingSession();
  const slugFromRequest = await getTenantSlugOrNull();

  if (!clientId) {
    if (slugFromRequest) {
      redirect(`/book/${slugFromRequest}`);
    }
    redirect("/");
  }

  const tenantSlug = await getTenantSlugForBookingClient(clientId);
  const t = await getT("booking", tenantSlug);

  // Everything below depends only on clientId/tenantSlug — one parallel
  // round trip instead of chaining tenant + policy before the rest (this
  // backs the native app's Account tab).
  const [
    tenant,
    businessTimezone,
    profileRes,
    appointments,
    storedValueRaw,
    smsConsent,
    activePlans,
  ] = await Promise.all([
    tenantSlug ? getTenantBySlug(tenantSlug) : Promise.resolve(null),
    tenantSlug
      ? getBusinessSettingsForTenant(tenantSlug).then((p) => p.timezone)
      : Promise.resolve("America/New_York"),
    getClientProfile(clientId),
    getClientAppointments(clientId),
    getClientStoredValuePublic(clientId).catch(() => null),
    getSmsConsentForBookingClient(clientId),
    tenantSlug
      ? listActiveMembershipPlansPublic(tenantSlug)
      : Promise.resolve([]),
  ]);

  const storedValue = storedValueRaw
    ? {
        clientName: storedValueRaw.clientName,
        balanceCents: storedValueRaw.balanceCents,
        membership: storedValueRaw.membership
          ? {
              id: storedValueRaw.membership.id,
              status: storedValueRaw.membership.status,
              planName: storedValueRaw.membership.planName,
              planId: storedValueRaw.membership.planId,
              monthlyAmountCents: storedValueRaw.membership.monthlyAmountCents,
              currentPeriodEnd:
                storedValueRaw.membership.currentPeriodEnd?.toISOString() ??
                null,
            }
          : null,
        transactions: storedValueRaw.transactions.map((t) => ({
          id: t.id,
          type: t.type,
          amountCents: t.amountCents,
          runningBalanceCents: t.runningBalanceCents,
          note: t.note,
          createdAt: t.createdAt.toISOString(),
        })),
      }
    : null;

  const upcoming = appointments.upcoming.map((a) => ({
    ...a,
    start: a.start.toISOString(),
    end: a.end.toISOString(),
  }));
  const past = appointments.past.map((a) => ({
    ...a,
    start: a.start.toISOString(),
    end: a.end.toISOString(),
  }));

  return (
    <AccountHub
      clientId={clientId}
      businessName={tenant?.name ?? t("accountPage.defaultName")}
      subscribeTenantSlug={tenantSlug}
      hasSubscribeablePlans={activePlans.length > 0}
      initialProfile={profileRes.profile}
      profileError={profileRes.error}
      upcoming={upcoming}
      past={past}
      appointmentsError={appointments.error}
      storedValue={storedValue}
      smsConsent={{
        consented: smsConsent.consented,
        consentedAt: smsConsent.consentedAt?.toISOString() ?? null,
        method: smsConsent.method,
      }}
      businessTimezone={businessTimezone}
    />
  );
}

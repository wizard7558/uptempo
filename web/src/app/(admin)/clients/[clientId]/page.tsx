import { getClient, getClientServiceHistoryAction, getServiceFrequency } from "@/actions/clients";
import { getClientOverrides } from "@/actions/overrides";
import { getFormResponsesForClient } from "@/actions/forms";
import { getSmsConsentForClient } from "@/actions/sms";
import { getClientCardForAdmin } from "@/actions/stripe";
import {
  getClientMembershipAndStoredValue,
  listMembershipPlans,
} from "@/actions/membership";
import { listCustomFieldDefinitions } from "@/actions/custom-fields";
import { ClientProfile } from "@/components/clients/client-profile";
import { CustomFieldsCard } from "@/components/custom-fields/custom-fields-card";
import { getClientCredits, listPackages } from "@/actions/packages";
import { getTenantSlug } from "@/lib/tenant/context";
import { hasModule } from "@/lib/tenant/modules";
import { notFound } from "next/navigation";

export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const [
    client,
    history,
    overrides,
    frequency,
    formResponses,
    smsConsent,
    storedValue,
    membershipPlans,
    card,
  ] = await Promise.all([
    getClient(clientId),
    getClientServiceHistoryAction(clientId),
    getClientOverrides(clientId),
    getServiceFrequency(clientId),
    getFormResponsesForClient(clientId),
    getSmsConsentForClient(clientId),
    getClientMembershipAndStoredValue(clientId),
    listMembershipPlans(),
    getClientCardForAdmin(clientId),
  ]);

  if (!client) notFound();

  const definitions = await listCustomFieldDefinitions("client");

  // Credits card: only when the session packs module is on.
  const packsOn = await hasModule(await getTenantSlug(), "packages");
  let credits: { data: Awaited<ReturnType<typeof getClientCredits>>; packs: Awaited<ReturnType<typeof listPackages>> } | null = null;
  if (packsOn) {
    const data = await getClientCredits(clientId);
    credits = { data, packs: data.canManage ? await listPackages() : [] };
  }

  return (
    <div className="p-6 space-y-6">
      <ClientProfile
        client={client}
        history={history}
        overrides={overrides}
        frequency={frequency}
        formResponses={formResponses}
        smsConsent={smsConsent}
        storedValue={storedValue}
        card={
          card.hasCard
            ? {
                hasCard: true,
                brand: card.brand,
                last4: card.last4,
                expMonth: card.expMonth,
                expYear: card.expYear,
              }
            : { hasCard: false }
        }
        credits={credits}
        membershipPlans={membershipPlans
          .filter((p) => p.isActive === 1)
          .map((p) => ({
            id: p.id,
            name: p.name,
            monthlyAmountCents: p.monthlyAmountCents,
          }))}
      />
      <CustomFieldsCard
        entity="client"
        ownerId={client.id}
        definitions={definitions}
        values={client.attributes ?? {}}
        canEdit
      />
    </div>
  );
}

"use client";

import { useT, useTerms } from "@/lib/terms/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClientProfileForm } from "@/components/booking-public/client-profile-form";
import { ClientFieldsSection } from "@/components/booking-public/client-fields-section";
import { StoredValueSection } from "@/components/booking-public/stored-value-section";
import { CardManagement } from "@/components/booking-public/card-management";
import { ClientAppointmentsList } from "@/components/booking-public/client-appointments-list";
import { ClientNotifications } from "@/components/booking-public/client-notifications";
import { DeleteAccountSection } from "@/components/booking-public/delete-account-section";
import type { ClientProfileData } from "@/actions/client-profile";

export type AccountAppointmentRow = {
  id: string;
  staffName: string;
  serviceNames: string[];
  start: string;
  end: string;
  status: string;
  cancelToken: string;
  rescheduleToken: string;
};

export type StoredValueInitial = {
  clientName: string;
  balanceCents: number;
  membership: {
    id: string;
    status: string;
    planName: string;
    planId: string;
    monthlyAmountCents: number;
    currentPeriodEnd: string | null;
  } | null;
  transactions: {
    id: string;
    type: string;
    amountCents: number;
    runningBalanceCents: number;
    note: string | null;
    createdAt: string;
  }[];
};

interface AccountHubProps {
  clientId: string;
  businessName: string;
  /** Tenant slug for `/subscribe/[slug]` when membership plans exist */
  subscribeTenantSlug?: string | null;
  hasSubscribeablePlans?: boolean;
  initialProfile: ClientProfileData | null;
  profileError?: string;
  upcoming: AccountAppointmentRow[];
  past: AccountAppointmentRow[];
  appointmentsError?: string;
  storedValue: StoredValueInitial | null;
  smsConsent: {
    consented: boolean;
    consentedAt: string | null;
    method: string | null;
  };
  businessTimezone: string;
}

export function AccountHub({
  clientId,
  businessName,
  subscribeTenantSlug,
  hasSubscribeablePlans,
  initialProfile,
  profileError,
  upcoming,
  past,
  appointmentsError,
  storedValue,
  smsConsent,
  businessTimezone,
}: AccountHubProps) {
  const t = useT("booking");
  const { prepaidBalance } = useTerms();
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8 space-y-5 sm:space-y-6">
      <div>
        <h1 className="display text-3xl sm:text-4xl text-[var(--ink)]">
          My account
        </h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">{businessName}</p>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        {/* Single-row swipeable strip — five tabs never fit a phone width,
            and wrapping collides with the list's underline border. */}
        <TabsList
          variant="default"
          className="flex h-auto w-full items-center justify-start gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="payment">Payment</TabsTrigger>
          <TabsTrigger value="stored-value">{prepaidBalance}</TabsTrigger>
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
          <TabsTrigger value="notifications">Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4 space-y-6">
          <ClientProfileForm
            clientId={clientId}
            initialProfile={initialProfile}
            errorMessage={profileError}
          />
          <ClientFieldsSection
            clientId={clientId}
            definitions={initialProfile?.clientFields ?? []}
            values={initialProfile?.attributes ?? {}}
          />
          <DeleteAccountSection />
        </TabsContent>

        <TabsContent value="payment" className="mt-4 space-y-4">
          <div>
            <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--ink)]">
              Payment method
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              {t("accountHub.paymentHint")}
            </p>
          </div>
          <CardManagement clientId={clientId} />
        </TabsContent>

        <TabsContent value="stored-value" className="mt-4 space-y-6">
          <StoredValueSection
            clientId={clientId}
            initialData={storedValue}
            subscribeHref={
              subscribeTenantSlug && hasSubscribeablePlans
                ? `/subscribe/${subscribeTenantSlug}`
                : undefined
            }
          />
        </TabsContent>

        <TabsContent value="appointments" className="mt-4">
          <ClientAppointmentsList
            upcoming={upcoming}
            past={past}
            errorMessage={appointmentsError}
            businessTimezone={businessTimezone}
          />
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <ClientNotifications
            clientId={clientId}
            businessName={businessName}
            initialPhone={initialProfile?.phone ?? ""}
            initialConsent={smsConsent}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

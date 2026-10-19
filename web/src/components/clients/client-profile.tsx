"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { ClientEditForm } from "./client-edit-form";
import { ClientCardOnFile } from "./client-card-on-file";
import { ServiceHistory } from "./service-history";
import { FrequencyTracker } from "./frequency-tracker";
import { OverrideManager } from "./override-manager";
import { FormResponses, type FormResponseRow } from "./form-responses";
import { ClientStoredValuePanel } from "./client-stored-value-panel";
import { ClientCreditsCard } from "./client-credits";
import type { ClientCredits, PackageRow } from "@/actions/packages";
import { toggleSmsConsentForClient } from "@/actions/sms";
import { toast } from "sonner";
import type { ServiceHistoryEntry } from "@/lib/queries/client-history";
import type { ServiceFrequency } from "@/actions/clients";
import { useT } from "@/lib/terms/client";

interface ClientProfileProps {
  client: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  history: ServiceHistoryEntry[];
  overrides: {
    serviceId: string;
    serviceName: string;
    defaultDurationMinutes: number;
    defaultPriceCents: number | null;
    overrideDurationMinutes: number | null;
    overridePriceCents: number | null;
  }[];
  frequency: ServiceFrequency[];
  formResponses: FormResponseRow[];
  smsConsent: {
    consented: boolean;
    consentedAt: Date | null;
    method: string | null;
  };
  storedValue: {
    balanceCents: number;
    membership: {
      id: string;
      status: string;
      stripeSubscriptionId: string | null;
      currentPeriodEnd: Date | null;
      planName: string;
      planId: string;
      monthlyAmountCents: number;
    } | null;
    transactions: {
      id: string;
      type: string;
      amountCents: number;
      runningBalanceCents: number;
      note: string | null;
      createdAt: Date;
    }[];
  };
  card: {
    hasCard: boolean;
    brand?: string | null;
    last4?: string | null;
    expMonth?: number | null;
    expYear?: number | null;
  };
  membershipPlans: { id: string; name: string; monthlyAmountCents: number }[];
  /** Present only when the session packs module is on. */
  credits?: { data: ClientCredits; packs: PackageRow[] } | null;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ClientProfile({
  client,
  history,
  overrides,
  frequency,
  formResponses,
  smsConsent,
  storedValue,
  card,
  membershipPlans,
  credits,
}: ClientProfileProps) {
  const t = useT("clients");
  const [smsEnabled, setSmsEnabled] = useState(smsConsent.consented);
  const [isPending, startTransition] = useTransition();

  function handleSmsToggle(checked: boolean) {
    if (!client.phone) return;
    setSmsEnabled(checked);
    startTransition(async () => {
      const result = await toggleSmsConsentForClient(
        client.id,
        client.phone!,
        checked,
      );
      if (result.success) {
        toast.success(
          checked
            ? "SMS reminders enabled for this client."
            : "SMS reminders disabled for this client.",
        );
      } else {
        setSmsEnabled(!checked); // revert
        toast.error("Failed to update SMS consent.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to clients
      </Link>

      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="text-lg">
            {getInitials(client.name)}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-2xl font-bold">{client.name}</h1>
          <div className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
            {client.email && <span>{client.email}</span>}
            {client.phone && <span>{client.phone}</span>}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Client since {format(client.createdAt, "MMM d, yyyy")}
          </p>
        </div>
      </div>

      {/* SMS Consent Toggle */}
      <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">SMS Reminders</p>
            {!client.phone ? (
              <p className="text-xs text-muted-foreground">
                Client has no phone number on file
              </p>
            ) : smsEnabled && smsConsent.consentedAt ? (
              <p className="text-xs text-muted-foreground">
                Opted in via {smsConsent.method ?? "unknown"} on{" "}
                {format(new Date(smsConsent.consentedAt), "MMM d, yyyy")}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Not opted in</p>
            )}
          </div>
        </div>
        <Switch
          checked={smsEnabled}
          onCheckedChange={handleSmsToggle}
          disabled={!client.phone || isPending}
        />
      </div>

      <Tabs defaultValue="overview">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="history">Service History</TabsTrigger>
          <TabsTrigger value="forms">Forms</TabsTrigger>
          <TabsTrigger value="overrides">Service Overrides</TabsTrigger>
          <TabsTrigger value="stored-value">{t("clientProfile.prepaidTab")}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-6">
          <ClientEditForm client={client} />
          <ClientCardOnFile clientId={client.id} card={card} />
          {credits && (
            <ClientCreditsCard
              clientId={client.id}
              credits={credits.data}
              packs={credits.packs}
              hasCard={card.hasCard}
            />
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <FrequencyTracker frequency={frequency} />
          <ServiceHistory history={history} />
        </TabsContent>

        <TabsContent value="forms">
          <FormResponses formResponses={formResponses} />
        </TabsContent>

        <TabsContent value="overrides">
          <OverrideManager clientId={client.id} overrides={overrides} />
        </TabsContent>

        <TabsContent value="stored-value">
          <ClientStoredValuePanel
            clientId={client.id}
            balanceCents={storedValue.balanceCents}
            membership={storedValue.membership}
            transactions={storedValue.transactions}
            plans={membershipPlans}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

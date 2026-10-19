"use server";

import { destinationRefundParamsForIntent } from "@/lib/stripe/refund-params";
import { AuthError, requireStaff } from "@/lib/auth/rbac";

import { getEmailT } from "@/lib/terms/email";
import { getEmailBranding } from "@/lib/email/branding";
import { getT } from "@/lib/terms/server";
import type Stripe from "stripe";
import { withTenantDb } from "@/lib/db/tenant";
import { getPaymentMethodSettingsForTenant } from "@/lib/policies/business-policy";
import { getStripe } from "@/lib/stripe/server";
import { calculateAppointmentPrice } from "@/lib/services/policy-engine";
import { processOffSessionCharge } from "@/lib/services/charge-processing";
import { createActionToken, verifyActionToken } from "@/lib/email/tokens";
import { sendEmail } from "@/lib/email/send";
import { getTenantBySlug, resolveTenantSlugForAppointment } from "@/lib/tenant/registry";
import { processingRateBps, processingRateLabel } from "@/lib/billing/processing-fee";
import { CheckoutLinkEmail } from "@/emails/checkout-link";
import { ReceiptEmail } from "@/emails/receipt";
import { sendSms } from "@/lib/sms/send";
import { eq, and, gte, lte, sql, desc, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { format } from "date-fns";
import { trackEvent } from "@/lib/analytics/events";
import { getStoredValueBalanceCents } from "@/lib/services/stored-value-ledger";
import { getBaseUrl } from "@/lib/utils";
import { getNotificationSettingsForTenant } from "@/lib/notifications/settings";
import type { TenantDb } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";
import { buildStoredValueCheckoutPreview } from "@/lib/checkout/stored-value-preview";
import { hasModule } from "@/lib/tenant/modules";
import { loadCheckoutSet, resolveDepositToApply } from "@/lib/checkout/checkout-set";
import { computeCheckoutAmounts } from "@/lib/checkout/due-now";
import { hasCompletedServicePayment, recordServicePayment } from "@/lib/checkout/record-payment";
import { REVENUE_CHARGE_REASONS } from "@/lib/revenue/charge-reasons";
import {
  debitGiftCard,
  findGiftCardByCode,
  GiftCardBalanceError,
  reverseGiftCardDebit,
} from "@/lib/gift-cards/service";

/**
 * Staff pass true or false. A public pay link omits the flag: the last
 * scheduled session of a project takes the deposit credit, matching the
 * checkout dialog's default.
 */
function checkoutTokenMatches(appointmentId: string, token: string): boolean {
  const payload = verifyActionToken(token);
  return payload?.action === "checkout" && payload.appointmentId === appointmentId;
}

function finalProjectSessionChoice(
  set: Parameters<typeof resolveDepositToApply>[0],
  explicit: boolean | undefined,
): boolean {
  if (explicit !== undefined) return explicit;
  return set.project?.isLastScheduled === true;
}

/** Amounts for a checkout set; every server path (and the dialog) goes through computeCheckoutAmounts. */
function amountsForSet(
  set: Parameters<typeof resolveDepositToApply>[0] & { creditCovered: boolean },
  p: {
    payingFullFromPrepaid: boolean;
    totalCents: number;
    tipCents: number;
    preview: ReturnType<typeof buildStoredValueCheckoutPreview>;
    finalProjectSession?: boolean;
    gift?: { balanceCents: number; requestedCents: number | null } | null;
  },
) {
  return computeCheckoutAmounts({
    payingFullFromPrepaid: p.payingFullFromPrepaid,
    totalCents: p.totalCents,
    tipCents: p.tipCents,
    partialBankAppliedCents: p.preview.partialBbAppliedCents,
    discountedTotalCents: p.preview.discountedTotalCents,
    depositAppliedCents: resolveDepositToApply(set, finalProjectSessionChoice(set, p.finalProjectSession)),
    creditCovered: set.creditCovered,
    giftBalanceCents: p.gift?.balanceCents ?? 0,
    giftRequestedCents: p.gift ? p.gift.requestedCents : null,
  });
}

async function fetchActiveMemberDiscountPercent(
  db: TenantDb,
  tables: TenantTables,
  clientId: string,
): Promise<{ hasActiveMembership: boolean; memberDiscountPercent: number }> {
  const { clientMemberships, membershipPlans } = tables;
  const [row] = await db
    .select({
      retailDiscountPercent: membershipPlans.retailDiscountPercent,
    })
    .from(clientMemberships)
    .innerJoin(
      membershipPlans,
      eq(clientMemberships.planId, membershipPlans.id),
    )
    .where(
      and(
        eq(clientMemberships.clientId, clientId),
        eq(clientMemberships.status, "active"),
      ),
    )
    .limit(1);
  if (!row) {
    return { hasActiveMembership: false, memberDiscountPercent: 0 };
  }
  return {
    hasActiveMembership: true,
    memberDiscountPercent: row.retailDiscountPercent ?? 0,
  };
}

/**
 * Fetch all data needed to render the checkout dialog for an appointment.
 */
export async function getCheckoutData(appointmentId: string, finalProjectSession?: boolean) {
  const { tenantSlug: slug } = await requireStaff();
  const creditsEnabled = await hasModule(slug, "packages");
  const giftCardsEnabled = await hasModule(slug, "gift_cards");

  return withTenantDb(
    slug,
    async (db, tables) => {
      const { appointments, clients, staff } = tables;
      const loaded = await loadCheckoutSet(db, tables, appointmentId, { creditsEnabled });
      if (!loaded.ok) {
        return { error: loaded.error };
      }
      const { set } = loaded;
      const apptServices = set.services;
      const appointment = { id: appointmentId, status: "confirmed" as const, clientId: set.payerClientId };

      // The payer is the client of the group (or of the single appointment).
      const [client] = await db
        .select({
          id: clients.id,
          name: clients.name,
          email: clients.email,
          phone: clients.phone,
          stripeCustomerId: clients.stripeCustomerId,
          stripePaymentMethodId: clients.stripePaymentMethodId,
        })
        .from(clients)
        .where(eq(clients.id, set.payerClientId))
        .limit(1);

      if (!client) {
        return { error: "Client not found" as const };
      }

      const [staffMember] = await db
        .select({ displayName: staff.displayName })
        .from(appointments)
        .innerJoin(staff, eq(staff.id, appointments.staffId))
        .where(eq(appointments.id, set.anchorId))
        .limit(1);

      const totalCents = calculateAppointmentPrice(apptServices);
      const storedValueBalanceCents = await getStoredValueBalanceCents(
        db,
        tables,
        appointment.clientId,
      );
      const { hasActiveMembership, memberDiscountPercent } =
        await fetchActiveMemberDiscountPercent(
          db,
          tables,
          appointment.clientId,
        );
      const bbPreview = buildStoredValueCheckoutPreview(
        storedValueBalanceCents,
        totalCents,
        memberDiscountPercent,
        hasActiveMembership,
      );
      const storedValueAppliedCents = bbPreview.partialBbAppliedCents;

      // Credit any deposit already collected at booking against today's amount.
      const { depositAppliedCents, remainderCents: cardChargeCents } = amountsForSet(set, {
        payingFullFromPrepaid: false,
        totalCents,
        tipCents: 0,
        preview: bbPreview,
        finalProjectSession,
      });

      return {
        appointment: {
          id: appointment.id,
          status: appointment.status,
        },
        group: set.groupId ? { id: set.groupId, count: set.appointmentIds.length } : null,
        client: {
          id: client.id,
          name: client.name,
          email: client.email,
          phone: client.phone,
          stripeCustomerId: client.stripeCustomerId,
          stripePaymentMethodId: client.stripePaymentMethodId,
          hasCardOnFile: !!client.stripePaymentMethodId,
        },
        services: apptServices.map((s) => ({
          serviceId: s.serviceId,
          serviceName: s.serviceName,
          priceCents: s.priceChargedCents ?? s.priceCents ?? 0,
        })),
        totalCents,
        storedValueBalanceCents,
        storedValueAppliedCents,
        cardChargeCents,
        depositAppliedCents,
        creditCovered: set.creditCovered,
        creditEligible: set.creditEligible,
        project: set.project,
        hasActiveMembership,
        memberDiscountPercent: bbPreview.memberDiscountPercent,
        fullBbDiscountedTotalCents: bbPreview.discountedTotalCents,
        eligibleForFullBb: bbPreview.eligibleForFullBb,
        staffName: staffMember?.displayName ?? "Unknown",
        giftCardsEnabled,
      };
    },
  );
}

/**
 * Complete an appointment checkout with the selected payment method.
 * Handles card_on_file (via processOffSessionCharge), new_card (via passed paymentIntentId), and cash.
 */
export async function completeAppointment(data: {
  appointmentId: string;
  paymentMethod: "card_on_file" | "new_card" | "cash" | "stored_value" | "gift_card";
  stripePaymentIntentId?: string;
  /** Gratuity in cents (added on top of service total; stored value applies to services only). */
  tipCents?: number;
  /** Multi-session projects: apply the project's whole deposit credit (this is its last session). */
  finalProjectSession?: boolean;
  /** Present on the public pay link. Staff checkout omits it. */
  token?: string;
  /** Applied after the deposit and the prepaid balance. Debited before the card charge. */
  giftCard?: { code: string; amountCents: number };
}) {
  let slug: string;
  if (data.token) {
    if (!checkoutTokenMatches(data.appointmentId, data.token)) {
      return { success: false as const, error: "Invalid checkout link" };
    }
    const resolved = await resolveTenantSlugForAppointment(data.appointmentId);
    if (!resolved) {
      return { success: false as const, error: "Appointment not found" };
    }
    slug = resolved;
  } else {
    slug = (await requireStaff()).tenantSlug;
  }
  try {

    return await withTenantDb(
      slug,
      async (db, tables) => {
        const { appointmentServices, clients } = tables;

        // Step 1: Validate status and gather everything this checkout pays for
        // (one appointment, or every confirmed member of a group booking).
        const loaded = await loadCheckoutSet(db, tables, data.appointmentId);
        if (!loaded.ok) {
          return { success: false as const, error: loaded.error };
        }
        const { set } = loaded;
        const appointment = { clientId: set.payerClientId };

        // Idempotency guard: a completed service_payment already covers this set.
        if (await hasCompletedServicePayment(db, tables, set)) {
          return {
            success: false as const,
            error: "Already checked out",
          };
        }

        // Step 2: Line items with prices (all members of a group)
        const apptServices = set.services;

        // Step 3: Calculate total, optional tip, and stored value application (server-side)
        const totalCents = calculateAppointmentPrice(apptServices);
        const tipCents = Math.min(
          Math.max(0, Math.round(Number(data.tipCents ?? 0))),
          500_000,
        );
        const { hasActiveMembership, memberDiscountPercent } =
          await fetchActiveMemberDiscountPercent(
            db,
            tables,
            appointment.clientId,
          );
        const balance = await getStoredValueBalanceCents(
          db,
          tables,
          appointment.clientId,
        );
        const bbPreview = buildStoredValueCheckoutPreview(
          balance,
          totalCents,
          memberDiscountPercent,
          hasActiveMembership,
        );

        // A credit-covered visit takes nothing from the prepaid balance (computeCheckoutAmounts
        // zeroes it), so the prepaid-balance eligibility checks do not apply.
        const te = await getT("errors", slug);
        if (data.paymentMethod === "stored_value" && !set.creditCovered) {
          if (tipCents > 0) {
            return {
              success: false as const,
              error: te("checkout.removeTip"),
            };
          }
          if (!bbPreview.eligibleForFullBb) {
            return {
              success: false as const,
              error: te("checkout.notEligible"),
            };
          }
          if (balance < bbPreview.discountedTotalCents) {
            return {
              success: false as const,
              error: te("checkout.insufficientBalance"),
            };
          }
        }
        if (data.paymentMethod === "stored_value" && data.giftCard) {
          return { success: false as const, error: te("giftCards.withFullPrepaid") };
        }

        let gift: { id: string; balanceCents: number; requestedCents: number } | null = null;
        if (data.giftCard) {
          if (!(await hasModule(slug, "gift_cards"))) {
            return { success: false as const, error: te("giftCards.notFound") };
          }
          const found = await findGiftCardByCode(db, tables, data.giftCard.code);
          if (!found) {
            return { success: false as const, error: te("giftCards.notFound") };
          }
          if (found.status !== "active") {
            return { success: false as const, error: te("giftCards.inactive") };
          }
          gift = {
            id: found.id,
            balanceCents: found.balanceCents,
            requestedCents: Math.round(data.giftCard.amountCents),
          };
        }

        // Credit any deposit already collected at booking against the amount due
        // now (the client must not be charged the deposit twice). Revenue is still
        // recognized in full via the service_payment row below; the deposit row
        // is a prepayment, not separate service revenue.
        const {
          totalWithTip,
          bankAppliedCents,
          depositAppliedCents: depositPaidCents,
          giftAppliedCents,
          remainderCents,
        } = amountsForSet(set, {
          payingFullFromPrepaid: data.paymentMethod === "stored_value",
          totalCents,
          tipCents,
          preview: bbPreview,
          finalProjectSession: data.finalProjectSession,
          gift,
        });

        if (data.paymentMethod === "gift_card" && remainderCents > 0) {
          return {
            success: false as const,
            error: te("checkout.remainderDue", {
              amount: `$${(remainderCents / 100).toFixed(2)}`,
            }),
          };
        }

        const { getConnectChargeParams } = await import("@/lib/stripe/connect-charge-params");
        const connectParamsFull = await getConnectChargeParams(
          slug,
          totalWithTip,
        );
        const connectParamsRemainder =
          remainderCents > 0
            ? await getConnectChargeParams(slug, remainderCents)
            : null;

        // Debit the gift card before Stripe. A failed charge puts the money back.
        let giftDebit: { txId: string } | null = null;
        const undoGift = async () => {
          if (!giftDebit) return;
          const txId = giftDebit.txId;
          giftDebit = null;
          await db.transaction((tx) =>
            reverseGiftCardDebit(tx, tables, { txId, note: "Checkout did not finish" }),
          );
        };
        if (gift && giftAppliedCents > 0) {
          const giftCardId = gift.id;
          try {
            giftDebit = await db.transaction((tx) =>
              debitGiftCard(tx, tables, {
                giftCardId,
                cents: giftAppliedCents,
                appointmentId: data.appointmentId,
                createdBy: null,
              }),
            );
          } catch (err) {
            if (err instanceof GiftCardBalanceError) {
              if (data.paymentMethod === "new_card" && data.stripePaymentIntentId) {
                await getStripe().refunds.create({
                  payment_intent: data.stripePaymentIntentId,
                  ...(await destinationRefundParamsForIntent(data.stripePaymentIntentId, { undo: true })),
                });
              }
              return { success: false as const, error: te("giftCards.balanceChanged") };
            }
            throw err;
          }
        }

        // Step 4: External Stripe charges (remainder only) before the service ledger
        let chargeStatus: "completed" | "failed" = "completed";
        let stripePaymentIntentId: string | null = null;
        const failureReason: string | null = null;
        let step4Error: string | null = null;
        // The application fee actually sent to Stripe: only the card part carries one.
        let cardFeeCents = 0;

        if (remainderCents > 0 && data.paymentMethod === "card_on_file") {
          const [client] = await db
            .select({
              stripeCustomerId: clients.stripeCustomerId,
              stripePaymentMethodId: clients.stripePaymentMethodId,
            })
            .from(clients)
            .where(eq(clients.id, appointment.clientId))
            .limit(1);

          if (!client?.stripeCustomerId || !client?.stripePaymentMethodId) {
            step4Error = "No payment method on file";
          } else {
            const chargeResult = await processOffSessionCharge({
              amountCents: remainderCents,
              stripeCustomerId: client.stripeCustomerId,
              stripePaymentMethodId: client.stripePaymentMethodId,
              metadata: {
                appointmentId: data.appointmentId,
                reason: "service_payment",
                clientId: appointment.clientId,
                tenantSlug: slug,
                ...(set.groupId ? { bookingGroupId: set.groupId } : {}),
              },
              ...(connectParamsRemainder
                ? {
                    connectAccountId: connectParamsRemainder.connectAccountId,
                    platformFeeCents: connectParamsRemainder.platformFeeCents,
                  }
                : {}),
            });

            if (chargeResult.status === "failed") {
              step4Error = chargeResult.failureReason ?? "Payment failed";
            } else {
              chargeStatus = chargeResult.status as "completed";
              stripePaymentIntentId = chargeResult.stripePaymentIntentId;
              cardFeeCents = connectParamsRemainder?.platformFeeCents ?? 0;
            }
          }
        } else if (remainderCents > 0 && data.paymentMethod === "new_card") {
          stripePaymentIntentId = data.stripePaymentIntentId ?? null;
          if (!stripePaymentIntentId) {
            step4Error = "Missing payment confirmation";
          } else {
            const pi = await getStripe().paymentIntents.retrieve(
              stripePaymentIntentId,
            );
            if (pi.amount !== remainderCents) {
              step4Error = "Payment amount does not match balance due";
            } else {
              chargeStatus = "completed";
              cardFeeCents = pi.application_fee_amount ?? 0;
            }
          }
        } else if (remainderCents > 0 && data.paymentMethod === "cash") {
          chargeStatus = "completed";
          stripePaymentIntentId = null;
        } else {
          // remainder === 0 — prepaid balance, gift card, or both cover the visit
          chargeStatus = "completed";
          stripePaymentIntentId = null;
        }

        if (step4Error) {
          await undoGift();
          return { success: false as const, error: step4Error };
        }

        // Step 5: Ledger + ONE charge + every appointment completed, in one transaction
        let recorded: Awaited<ReturnType<typeof recordServicePayment>>;
        try {
          recorded = await recordServicePayment(db, tables, {
            set,
            amountCents: totalWithTip,
            tipCents,
            status: chargeStatus,
            stripePaymentIntentId,
            failureReason,
            platformFeeCents: cardFeeCents > 0 ? cardFeeCents : null,
            connectAccountId: connectParamsFull?.connectAccountId ?? null,
            storedValueCents: bankAppliedCents,
            depositAppliedCents: depositPaidCents,
            giftCardId: gift?.id ?? null,
            giftCardCents: giftAppliedCents > 0 ? giftAppliedCents : null,
            giftCardTxId: giftDebit?.txId ?? null,
            ledgerNote:
              data.paymentMethod === "stored_value" && bankAppliedCents < totalCents
                ? te("checkout.ledgerNoteMemberDiscount")
                : "Service checkout",
          });
        } catch (err) {
          await undoGift();
          throw err;
        }
        if (!recorded.ok) {
          await undoGift();
          return { success: false as const, error: recorded.error };
        }
        const charge = { id: recorded.chargeId };

        revalidatePath("/schedule");
        revalidatePath("/charges");

        (async () => {
          try {
            const { hasModule } = await import("@/lib/tenant/modules");
            if (!(await hasModule(slug, "aftercare"))) return;
            const { getAftercareTemplatesForTenantServices } = await import(
              "@/lib/aftercare/for-tenant"
            );
            const svcIds = await db
              .select({ serviceId: appointmentServices.serviceId })
              .from(appointmentServices)
              .where(inArray(appointmentServices.appointmentId, set.appointmentIds));
            const serviceIdList = [...new Set(svcIds.map((s) => s.serviceId))];

            const aftercareList =
              await getAftercareTemplatesForTenantServices(
                slug,
                serviceIdList,
              );
            if (aftercareList.length === 0) return;

            const [clientData] = await db
              .select({
                email: clients.email,
                name: clients.name,
                phone: clients.phone,
              })
              .from(clients)
              .where(eq(clients.id, appointment.clientId))
              .limit(1);
            if (!clientData) return;

            const [emailT, branding] = await Promise.all([
              getEmailT(slug, "emails"),
              getEmailBranding(slug),
            ]);
            const businessName = branding.businessName;

            const policies = await getNotificationSettingsForTenant(slug);

            if (clientData.email) {
              const { AftercareEmail } = await import("@/emails/aftercare");
              const { sendEmail: sendEmailFn } = await import(
                "@/lib/email/send"
              );
              await sendEmailFn({
                to: clientData.email,
                subject: emailT("aftercare.subject", { business: businessName }),
                react: AftercareEmail({
                  t: emailT,
                  businessName,
                  clientName: clientData.name,
                  templates: aftercareList,
                  logoUrl: branding.logoUrl,
                  brandColor: branding.brandColor,
                }),
                businessName,
              });
            }

            if (
              policies.smsAftercareEnabled === 1 &&
              clientData.phone
            ) {
              const token = createActionToken(
                data.appointmentId,
                "aftercare",
                168,
              );
              const url = `${getBaseUrl()}/aftercare/${data.appointmentId}?token=${encodeURIComponent(token)}`;
              const smsBody = `${businessName}: your aftercare instructions — ${url}`;
              await sendSms({
                to: clientData.phone,
                body: smsBody,
                tenantSlug: slug,
                clientId: appointment.clientId,
                appointmentId: data.appointmentId,
                messageType: "aftercare",
              });
            }
          } catch (err) {
            console.error(
              "Aftercare email failed:",
              data.appointmentId,
              err,
            );
          }
        })();

        trackEvent(
          "checkout.completed",
          {
            method: data.paymentMethod,
            storedValueCents: bankAppliedCents,
            tipCents,
          },
          { tenantSlug: slug },
        );

        // The fee Stripe took on the card part (same as stored on the charge row),
        // and the rate the business is on, for the done screen. No card fee means
        // the screen shows no card processing line.
        const storedFeeCents = cardFeeCents;
        let processingLabel: string | null = null;
        if (storedFeeCents > 0) {
          const tenant = await getTenantBySlug(slug);
          if (tenant) {
            processingLabel = processingRateLabel(processingRateBps(tenant));
          }
        }

        return {
          success: true as const,
          chargeId: charge.id,
          totalCents: totalWithTip,
          platformFeeCents: storedFeeCents,
          processingRateLabel: processingLabel,
        };
      },
    );
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return {
      success: false as const,
      error: "Failed to complete checkout",
    };
  }
}

/**
 * Create a Stripe PaymentIntent for the "new card" checkout flow.
 * Returns the clientSecret for client-side Stripe Elements confirmation.
 */
export async function createCheckoutPaymentIntent(
  appointmentId: string,
  tipCentsArg?: number,
  /** Multi-session projects: the staff member marked this as the last session. */
  finalProjectSession?: boolean,
  /**
   * Staff checkout passes a gift card. The public pay link passes its token.
   * The two callers never send both in this argument.
   */
  giftCardOrToken?: { code: string; amountCents: number } | string,
) {
  const giftCard = typeof giftCardOrToken === "object" ? giftCardOrToken : undefined;
  const token = typeof giftCardOrToken === "string" ? giftCardOrToken : undefined;
  let slug: string;
  if (token) {
    if (!checkoutTokenMatches(appointmentId, token)) {
      return { error: "Invalid checkout link" };
    }
    const resolved = await resolveTenantSlugForAppointment(appointmentId);
    if (!resolved) {
      return { error: "Appointment not found" };
    }
    slug = resolved;
  } else {
    slug = (await requireStaff()).tenantSlug;
  }

  const tipCents = Math.min(
    Math.max(0, Math.round(Number(tipCentsArg ?? 0))),
    500_000,
  );

  // Fetch appointment, total, stored-value remainder for card charge
  const data = await withTenantDb(
    slug,
    async (db, tables) => {
      const { clients } = tables;
      const loaded = await loadCheckoutSet(db, tables, appointmentId);
      if (!loaded.ok) {
        return { error: loaded.error };
      }
      const { set } = loaded;
      const appointment = { clientId: set.payerClientId };
      const apptServices = set.services;

      const totalCents = calculateAppointmentPrice(apptServices);
      const balance = await getStoredValueBalanceCents(
        db,
        tables,
        appointment.clientId,
      );
      const { hasActiveMembership, memberDiscountPercent } =
        await fetchActiveMemberDiscountPercent(db, tables, appointment.clientId);
      const bbPreview = buildStoredValueCheckoutPreview(
        balance,
        totalCents,
        memberDiscountPercent,
        hasActiveMembership,
      );
      let gift: { balanceCents: number; requestedCents: number } | null = null;
      if (giftCard) {
        const found = await findGiftCardByCode(db, tables, giftCard.code);
        if (found && found.status === "active") {
          gift = { balanceCents: found.balanceCents, requestedCents: Math.round(giftCard.amountCents) };
        }
      }
      // Same numbers completeAppointment expects the PaymentIntent to equal.
      const { totalWithTip, giftAppliedCents, remainderCents: cardChargeCents } = amountsForSet(set, {
        payingFullFromPrepaid: false,
        totalCents,
        tipCents,
        preview: bbPreview,
        finalProjectSession,
        gift,
      });

      const [client] = await db
        .select({
          id: clients.id,
          stripeCustomerId: clients.stripeCustomerId,
          email: clients.email,
          phone: clients.phone,
        })
        .from(clients)
        .where(eq(clients.id, appointment.clientId))
        .limit(1);

      return {
        appointment,
        client,
        totalCents,
        totalWithTip,
        cardChargeCents,
        giftAppliedCents,
        groupId: set.groupId,
        giftRefused: Boolean(giftCard) && !gift,
      };
    },
  );

  if ("error" in data) {
    return { error: data.error };
  }

  const { client, cardChargeCents, giftAppliedCents, giftRefused } = data;

  if (!client) {
    return { error: "Client not found" as const };
  }

  const te = await getT("errors", slug);
  if (giftRefused) {
    return { error: te("giftCards.notFound") };
  }

  if (cardChargeCents === 0) {
    return {
      noCardChargeNeeded: true as const,
      message: giftCard ? te("giftCards.coversAll") : te("checkout.coversVisit"),
    };
  }

  let stripeCustomerId = client.stripeCustomerId;

  if (!stripeCustomerId) {
    const customer = await getStripe().customers.create({
      email: client.email ?? undefined,
      phone: client.phone ?? undefined,
      metadata: { clientId: client.id, tenantSlug: slug },
    });
    stripeCustomerId = customer.id;
    await withTenantDb(slug, async (db, { clients }) => {
      await db
        .update(clients)
        .set({ stripeCustomerId, updatedAt: new Date() })
        .where(eq(clients.id, client.id));
    });
  }

  const { getConnectChargeParams } = await import("@/lib/stripe/connect-charge-params");
  const connectParams = await getConnectChargeParams(slug, cardChargeCents);

  const pmSettings = await getPaymentMethodSettingsForTenant(slug);

  const intentParams: Stripe.PaymentIntentCreateParams = {
    amount: cardChargeCents,
    currency: "usd",
    customer: stripeCustomerId,
    metadata: {
      appointmentId,
      reason: "service_payment",
      tenantSlug: slug,
      tipCents: String(tipCents),
      ...(giftAppliedCents > 0 ? { giftCardCents: String(giftAppliedCents) } : {}),
      ...(data.groupId ? { bookingGroupId: data.groupId } : {}),
    },
  };

  // Determine payment method configuration
  const allMethodsEnabled =
    pmSettings.applePayEnabled === 1 &&
    pmSettings.googlePayEnabled === 1 &&
    pmSettings.afterpayEnabled === 1 &&
    pmSettings.cashappEnabled === 1;

  if (allMethodsEnabled) {
    // Let Stripe automatically determine available payment methods
    intentParams.automatic_payment_methods = { enabled: true };
  } else {
    // Build explicit payment method types list (card is always enabled)
    const types: string[] = ["card"];
    if (pmSettings.afterpayEnabled === 1) types.push("afterpay_clearpay");
    if (pmSettings.cashappEnabled === 1) types.push("cashapp");
    intentParams.payment_method_types = types;

    // Control Apple Pay / Google Pay via wallet options (they use the card type).
    // The wallets property is supported by the Stripe API but not yet typed
    // in stripe@20.x SDK, so we use a type assertion.
    intentParams.payment_method_options = {
      card: {
        wallets: {
          apple_pay: pmSettings.applePayEnabled === 1 ? "auto" : "never",
          google_pay: pmSettings.googlePayEnabled === 1 ? "auto" : "never",
        },
      } as Stripe.PaymentIntentCreateParams.PaymentMethodOptions.Card,
    };
  }

  if (connectParams) {
    intentParams.transfer_data = {
      destination: connectParams.connectAccountId,
    };
    if (connectParams.platformFeeCents > 0) {
      intentParams.application_fee_amount = connectParams.platformFeeCents;
    }
  }

  const paymentIntent = await getStripe().paymentIntents.create(intentParams);

  return { clientSecret: paymentIntent.client_secret };
}

/**
 * Generate a checkout token for client self-checkout.
 * Admin auth guarded via getTenantSlug (requires admin session).
 */
export async function generateCheckoutToken(appointmentId: string) {
  await requireStaff();
  const token = createActionToken(appointmentId, "checkout", 48);
  const url = `${getBaseUrl()}/checkout/${token}`;
  return { token, url };
}

/**
 * Send checkout link email to client.
 * Admin auth guarded via getTenantSlug (requires admin session).
 */
export async function sendCheckoutLink(appointmentId: string) {
  const { tenantSlug: slug } = await requireStaff();
  const { url: checkoutUrl } = await generateCheckoutToken(appointmentId);

  // Fetch appointment data for email
  const data = await withTenantDb(
    slug,
    async (db, { appointments, appointmentServices, services, clients, staff }) => {
      const [appointment] = await db
        .select({
          id: appointments.id,
          clientId: appointments.clientId,
          staffId: appointments.staffId,
          start: sql<string>`lower(${appointments.during})`,
        })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1);

      if (!appointment) return { error: "Appointment not found" as const };

      const [client] = await db
        .select({ name: clients.name, email: clients.email })
        .from(clients)
        .where(eq(clients.id, appointment.clientId))
        .limit(1);

      if (!client?.email) return { error: "Client has no email address" as const };

      const [staffMember] = await db
        .select({ displayName: staff.displayName })
        .from(staff)
        .where(eq(staff.id, appointment.staffId))
        .limit(1);

      const apptServices = await db
        .select({ serviceName: services.name })
        .from(appointmentServices)
        .innerJoin(services, eq(appointmentServices.serviceId, services.id))
        .where(eq(appointmentServices.appointmentId, appointmentId));

      return {
        clientName: client.name,
        clientEmail: client.email,
        staffName:
          staffMember?.displayName ?? (await getEmailT(slug, "emails"))("fallbacks.yourStaff"),
        services: apptServices.map((s) => s.serviceName),
        appointmentStart: new Date(appointment.start),
      };
    },
  );

  if ("error" in data) {
    return { success: false, error: data.error };
  }

  const [emailT, branding] = await Promise.all([
    getEmailT(slug, "emails"),
    getEmailBranding(slug),
  ]);
  const businessName = branding.businessName;

  const result = await sendEmail({
    to: data.clientEmail,
    subject: emailT("checkout.subject", { business: businessName }),
    react: CheckoutLinkEmail({
      t: emailT,
      businessName,
      clientName: data.clientName,
      staffName: data.staffName,
      services: data.services,
      date: format(data.appointmentStart, "EEEE, MMMM d, yyyy"),
      time: format(data.appointmentStart, "h:mm a"),
      checkoutUrl,
      logoUrl: branding.logoUrl,
      brandColor: branding.brandColor,
    }),
    businessName,
  });

  return { success: result.success };
}

/**
 * Fetch checkout data for the public client-facing checkout page.
 * NO admin auth. Tenant may come from middleware (e.g. custom domain) or is
 * resolved by scanning for the appointment (root-domain links like /checkout/:token).
 */
export async function getCheckoutDataPublic(appointmentId: string, token?: string) {
  if (token) {
    if (!checkoutTokenMatches(appointmentId, token)) {
      return { error: "Appointment not found" as const };
    }
  } else {
    await requireStaff();
  }
  const slug = await resolveTenantSlugForAppointment(appointmentId);
  if (!slug) {
    return { error: "Appointment not found" as const };
  }

  return withTenantDb(
    slug,
    async (db, tables) => {
      const { appointments, clients, staff } = tables;
      const loaded = await loadCheckoutSet(db, tables, appointmentId);
      if (!loaded.ok) {
        return { error: loaded.error };
      }
      const { set } = loaded;
      const apptServices = set.services;
      const appointment = { id: appointmentId, status: "confirmed" as const, clientId: set.payerClientId };

      // The payer is the client of the group (or of the single appointment).
      const [client] = await db
        .select({
          id: clients.id,
          name: clients.name,
          email: clients.email,
          phone: clients.phone,
          stripeCustomerId: clients.stripeCustomerId,
          stripePaymentMethodId: clients.stripePaymentMethodId,
        })
        .from(clients)
        .where(eq(clients.id, set.payerClientId))
        .limit(1);

      if (!client) {
        return { error: "Client not found" as const };
      }

      const [staffMember] = await db
        .select({ displayName: staff.displayName })
        .from(appointments)
        .innerJoin(staff, eq(staff.id, appointments.staffId))
        .where(eq(appointments.id, set.anchorId))
        .limit(1);

      const totalCents = calculateAppointmentPrice(apptServices);
      const storedValueBalanceCents = await getStoredValueBalanceCents(
        db,
        tables,
        appointment.clientId,
      );
      const { hasActiveMembership, memberDiscountPercent } =
        await fetchActiveMemberDiscountPercent(
          db,
          tables,
          appointment.clientId,
        );
      const bbPreview = buildStoredValueCheckoutPreview(
        storedValueBalanceCents,
        totalCents,
        memberDiscountPercent,
        hasActiveMembership,
      );
      const storedValueAppliedCents = bbPreview.partialBbAppliedCents;

      // Same deposit rule as staff checkout: the last scheduled session takes the project credit.
      const { depositAppliedCents, remainderCents: cardChargeCents } = amountsForSet(set, {
        payingFullFromPrepaid: false,
        totalCents,
        tipCents: 0,
        preview: bbPreview,
      });

      return {
        appointment: {
          id: appointment.id,
          status: appointment.status,
        },
        group: set.groupId ? { id: set.groupId, count: set.appointmentIds.length } : null,
        client: {
          id: client.id,
          name: client.name,
          email: client.email,
          phone: client.phone,
          stripeCustomerId: client.stripeCustomerId,
          stripePaymentMethodId: client.stripePaymentMethodId,
          hasCardOnFile: !!client.stripePaymentMethodId,
        },
        services: apptServices.map((s) => ({
          serviceId: s.serviceId,
          serviceName: s.serviceName,
          priceCents: s.priceChargedCents ?? s.priceCents ?? 0,
        })),
        totalCents,
        storedValueBalanceCents,
        storedValueAppliedCents,
        cardChargeCents,
        depositAppliedCents,
        creditCovered: set.creditCovered,
        creditEligible: set.creditEligible,
        project: set.project,
        hasActiveMembership,
        memberDiscountPercent: bbPreview.memberDiscountPercent,
        fullBbDiscountedTotalCents: bbPreview.discountedTotalCents,
        eligibleForFullBb: bbPreview.eligibleForFullBb,
        staffName: staffMember?.displayName ?? "Unknown",
      };
    },
  );
}

/**
 * Email or SMS a receipt for a completed checkout (admin).
 */
export async function sendReceipt(data: {
  appointmentId: string;
  channel: "email" | "sms";
}) {
  const { tenantSlug: slug } = await requireStaff();
  try {

    const row = await withTenantDb(
      slug,
      async (db, tables) => {
        const {
          appointments,
          appointmentServices,
          services,
          clients,
          charges,
        } = tables;

        const [appointment] = await db
          .select({
            id: appointments.id,
            status: appointments.status,
            clientId: appointments.clientId,
          })
          .from(appointments)
          .where(eq(appointments.id, data.appointmentId))
          .limit(1);

        if (!appointment || appointment.status !== "completed") {
          return { error: "Appointment not found or not checked out" as const };
        }

        const [charge] = await db
          .select({
            amountCents: charges.amountCents,
            tipCents: charges.tipCents,
            storedValueCents: charges.storedValueCents,
            giftCardCents: charges.giftCardCents,
            giftLast4: tables.giftCards.last4,
            createdAt: charges.createdAt,
          })
          .from(charges)
          .leftJoin(tables.giftCards, eq(charges.giftCardId, tables.giftCards.id))
          .where(
            and(
              eq(charges.appointmentId, data.appointmentId),
              eq(charges.reason, "service_payment"),
              eq(charges.status, "completed"),
            ),
          )
          .orderBy(desc(charges.createdAt))
          .limit(1);

        if (!charge) {
          return { error: "No completed charge for this visit" as const };
        }

        const [client] = await db
          .select({
            name: clients.name,
            email: clients.email,
            phone: clients.phone,
          })
          .from(clients)
          .where(eq(clients.id, appointment.clientId))
          .limit(1);

        if (!client) {
          return { error: "Client not found" as const };
        }

        const apptServices = await db
          .select({
            serviceName: services.name,
            priceChargedCents: appointmentServices.priceChargedCents,
            priceCents: services.priceCents,
          })
          .from(appointmentServices)
          .innerJoin(services, eq(appointmentServices.serviceId, services.id))
          .where(eq(appointmentServices.appointmentId, data.appointmentId));

        return { appointment, charge, client, apptServices };
      },
    );

    if ("error" in row) {
      return { success: false as const, error: row.error };
    }

    const { appointment, charge, client, apptServices } = row;
    const tipCents = charge.tipCents ?? 0;
    const bbCents = charge.storedValueCents ?? 0;

    const [emailT, branding] = await Promise.all([
      getEmailT(slug, "emails"),
      getEmailBranding(slug),
    ]);
    const businessName = branding.businessName;
    const paidAtLabel = format(
      charge.createdAt instanceof Date
        ? charge.createdAt
        : new Date(charge.createdAt),
      "MMM d, yyyy h:mm a",
    );

    const lineItems = apptServices.map((s) => ({
      label: s.serviceName,
      amountCents: s.priceChargedCents ?? s.priceCents ?? 0,
    }));

    if (bbCents > 0) {
      lineItems.push({
        label: emailT("receipt.prepaidApplied"),
        amountCents: -bbCents,
      });
    }
    const giftCents = charge.giftCardCents ?? 0;
    if (giftCents > 0 && charge.giftLast4) {
      const giftT = await getEmailT(slug, "giftCards");
      lineItems.push({
        label: giftT("checkout.receiptLine", { last4: charge.giftLast4 }),
        amountCents: -giftCents,
      });
    }

    if (data.channel === "email") {
      if (!client.email) {
        return {
          success: false as const,
          error: "Client has no email on file",
        };
      }
      const r = await sendEmail({
        to: client.email,
        subject: emailT("receiptMail.subject", { business: businessName }),
        react: ReceiptEmail({
          t: emailT,
          businessName,
          clientName: client.name,
          lineItems,
          tipCents,
          totalCents: charge.amountCents,
          paidAtLabel,
          logoUrl: branding.logoUrl,
          brandColor: branding.brandColor,
        }),
        businessName,
      });
      return r.success
        ? ({ success: true as const } as const)
        : ({ success: false as const, error: "Email failed" } as const);
    }

    if (!client.phone) {
      return { success: false as const, error: "Client has no phone on file" };
    }

    const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    const svcPart = apptServices
      .map(
        (s) =>
          `${s.serviceName} ${fmt(s.priceChargedCents ?? s.priceCents ?? 0)}`,
      )
      .join("; ");
    const bodyLines = [
      `${businessName} — receipt (${paidAtLabel})`,
      `Total ${fmt(charge.amountCents)}`,
      svcPart.slice(0, 220) + (svcPart.length > 220 ? "…" : ""),
    ];
    if (tipCents > 0) bodyLines.push(`Tip ${fmt(tipCents)}`);
    if (bbCents > 0) bodyLines.push(
      emailT("receipt.smsPrepaidLine", { amount: fmt(bbCents) }),
    );
    if (giftCents > 0 && charge.giftLast4) {
      const giftT = await getEmailT(slug, "giftCards");
      bodyLines.push(`${giftT("checkout.receiptLine", { last4: charge.giftLast4 })} ${fmt(giftCents)}`);
    }

    const sms = await sendSms({
      to: client.phone,
      body: bodyLines.join("\n"),
      tenantSlug: slug,
      clientId: appointment.clientId,
      appointmentId: data.appointmentId,
      messageType: "receipt",
    });

    if (!sms.success) {
      return {
        success: false as const,
        error:
          sms.error === "no_consent"
            ? "Client has not opted in to SMS"
            : sms.error === "quiet_hours"
              ? "Outside allowed SMS hours — try email or try again later"
              : "SMS failed to send",
      };
    }

    return { success: true as const };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return { success: false as const, error: "Failed to send receipt" };
  }
}

type StaffRevenueRow = {
  staffId: string;
  staffName: string;
  totalCents: number;
  tipsCents: number;
  serviceCents: number;
  platformFeeCents: number;
  netCents: number;
  chargeCount: number;
};

function addStaffRevenue(into: Map<string, StaffRevenueRow>, row: StaffRevenueRow) {
  const cur = into.get(row.staffId);
  if (!cur) {
    into.set(row.staffId, { ...row });
    return;
  }
  cur.totalCents += row.totalCents;
  cur.tipsCents += row.tipsCents;
  cur.serviceCents += row.serviceCents;
  cur.platformFeeCents += row.platformFeeCents;
  cur.netCents += row.netCents;
  cur.chargeCount += row.chargeCount;
}

/**
 * Per-staff revenue for a date range. Visit charges use REVENUE_CHARGE_REASONS.
 * A pack sale has no appointment; it counts for the staff member whose user id
 * is on the pack's purchase ledger row.
 */
export async function getStaffRevenue(dateRange: { start: Date; end: Date }) {
  const { tenantSlug: slug } = await requireStaff();

  return withTenantDb(
    slug,
    async (db, { charges, appointments, staff, creditLedger }) => {
      const inRange = and(
        eq(charges.status, "completed"),
        gte(charges.createdAt, dateRange.start),
        lte(charges.createdAt, dateRange.end),
      );
      const visits = await db
        .select({
          staffId: appointments.staffId,
          staffName: staff.displayName,
          totalCents: sql<number>`SUM(${charges.amountCents})::int`,
          tipsCents: sql<number>`SUM(COALESCE(${charges.tipCents}, 0))::int`,
          serviceCents:
            sql<number>`SUM(${charges.amountCents} - COALESCE(${charges.tipCents}, 0))::int`,
          platformFeeCents: sql<number>`SUM(COALESCE(${charges.platformFeeCents}, 0))::int`,
          netCents: sql<number>`SUM(${charges.amountCents} - COALESCE(${charges.platformFeeCents}, 0))::int`,
          chargeCount: sql<number>`COUNT(${charges.id})::int`,
        })
        .from(charges)
        .innerJoin(appointments, eq(charges.appointmentId, appointments.id))
        .innerJoin(staff, eq(appointments.staffId, staff.id))
        .where(and(inRange, inArray(charges.reason, [...REVENUE_CHARGE_REASONS])))
        .groupBy(appointments.staffId, staff.displayName);

      const packSales = await db
        .select({
          chargeId: charges.id,
          staffId: staff.id,
          staffName: staff.displayName,
          amountCents: charges.amountCents,
          tipCents: charges.tipCents,
          platformFeeCents: charges.platformFeeCents,
        })
        .from(charges)
        .innerJoin(
          creditLedger,
          and(eq(creditLedger.clientPackageId, charges.clientPackageId), eq(creditLedger.reason, "purchase")),
        )
        .innerJoin(staff, eq(staff.userId, creditLedger.createdBy))
        .where(and(inRange, isNull(charges.appointmentId), eq(charges.reason, "package_sale")));

      const byStaff = new Map<string, StaffRevenueRow>();
      for (const r of visits) {
        addStaffRevenue(byStaff, {
          staffId: r.staffId,
          staffName: r.staffName,
          totalCents: r.totalCents ?? 0,
          tipsCents: r.tipsCents ?? 0,
          serviceCents: r.serviceCents ?? 0,
          platformFeeCents: r.platformFeeCents ?? 0,
          netCents: r.netCents ?? 0,
          chargeCount: r.chargeCount ?? 0,
        });
      }
      const seenPack = new Set<string>();
      for (const sale of packSales) {
        if (seenPack.has(sale.chargeId)) continue;
        seenPack.add(sale.chargeId);
        const amount = sale.amountCents;
        const tip = sale.tipCents ?? 0;
        const fee = sale.platformFeeCents ?? 0;
        addStaffRevenue(byStaff, {
          staffId: sale.staffId,
          staffName: sale.staffName,
          totalCents: amount,
          tipsCents: tip,
          serviceCents: amount - tip,
          platformFeeCents: fee,
          netCents: amount - fee,
          chargeCount: 1,
        });
      }
      return [...byStaff.values()];
    },
  );
}

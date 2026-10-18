import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

/**
 * Test-mode check that Stripe bills what the hosted price calculator says.
 *
 *   npm run stripe:check-billing
 *
 * Refuses any sk_live_ key, with no override. Creates a Stripe test clock and,
 * on it, three customers with a visa test card and a subscription each (no
 * trial, no proration):
 *   A) 1 staff, no text line             expect $12.00
 *   B) 3 staff, text line, 100 texts     expect $33.00
 *   C) 9 staff, no text line             expect $42.00
 * It advances the clock one month and a day and compares each renewal invoice
 * total with hostedMonthlyCents(). The renewal invoice is the one to compare:
 * the first invoice (at creation) charges only the licensed items for period
 * one, while metered texts bill in arrears. The meter event sent inside period
 * one therefore lands on the renewal invoice, next to period two's licensed
 * items, so only that invoice carries every line the calculator prices.
 *
 * Then, on A's subscription (after the invoice comparison, so A's invoice still
 * reflects 1 staff), it applies the same item change syncHostedSubscription
 * makes for 2 staff (diffItems) and prints the extra-staff quantity before and
 * after (expect 0 then 1). The test clock is deleted at the end, which deletes
 * its customers and subscriptions.
 */
import Stripe from "stripe";
import { TEXTS_METER_EVENT } from "../../src/lib/billing/hosted-catalog";
import {
  HOSTED_EXTRA_STAFF_MONTHLY_LOOKUP_KEY,
  hostedMonthlyCents,
} from "../../src/lib/billing/hosted-pricing";
import { desiredItems, diffItems } from "../../src/lib/billing/subscriptions";

type Case = {
  name: string;
  staff: number;
  textLine: boolean;
  texts: number;
};

const CASES: Case[] = [
  { name: "A: 1 staff, no text line", staff: 1, textLine: false, texts: 0 },
  { name: "B: 3 staff, text line, 100 texts", staff: 3, textLine: true, texts: 100 },
  { name: "C: 9 staff, no text line", staff: 9, textLine: false, texts: 0 },
];

const CLOCK_TIMEOUT_MS = 120_000;
const INVOICE_TIMEOUT_MS = 60_000;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function addMonthAndDay(unixSeconds: number): number {
  const d = new Date(unixSeconds * 1000);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return Math.floor(d.getTime() / 1000);
}

async function waitFor<T>(
  label: string,
  timeoutMs: number,
  poll: () => Promise<T | null>,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await poll();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(2000);
  }
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY is not set.");
    process.exit(1);
  }
  if (key.startsWith("sk_live_")) {
    console.error("Refusing to use a live key (sk_live_). This check runs in test mode only.");
    process.exit(1);
  }
  if (!key.startsWith("sk_test_")) {
    console.error("STRIPE_SECRET_KEY must start with sk_test_.");
    process.exit(1);
  }

  const stripe = new Stripe(key);

  const wantedItems = CASES.map((c) =>
    desiredItems({
      billableStaff: c.staff,
      smsLineStatus: c.textLine ? "active" : "off",
    }),
  );
  const lookupKeys = [...new Set(wantedItems.flat().map((i) => i.lookupKey))];
  const priceIds = new Map<string, string>();
  const found = await stripe.prices.list({ lookup_keys: lookupKeys, limit: 100 });
  for (const p of found.data) if (p.lookup_key) priceIds.set(p.lookup_key, p.id);
  const missingKeys = lookupKeys.filter((k) => !priceIds.has(k));
  if (missingKeys.length > 0) {
    console.error(
      `Missing hosted prices: ${missingKeys.join(", ")}. Run \`npm run stripe:catalog\` first.`,
    );
    process.exit(1);
  }

  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: `uptempo-check-billing-${Date.now()}`,
  });
  console.log(`Test clock ${clock.id} frozen at ${new Date(clock.frozen_time * 1000).toISOString()}`);

  let mismatch = false;
  try {
    const subs: Array<{ c: Case; subscriptionId: string; customerId: string }> = [];
    for (const [i, c] of CASES.entries()) {
      const customer = await stripe.customers.create({
        name: `Check billing ${c.name}`,
        test_clock: clock.id,
        payment_method: "pm_card_visa",
        invoice_settings: { default_payment_method: "pm_card_visa" },
        metadata: { purpose: "uptempo_check_billing" },
      });
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: wantedItems[i].map((item) => ({
          price: priceIds.get(item.lookupKey)!,
          ...(item.quantity !== undefined ? { quantity: item.quantity } : {}),
        })),
        proration_behavior: "none",
        collection_method: "charge_automatically",
      });
      subs.push({ c, subscriptionId: subscription.id, customerId: customer.id });

      if (c.texts > 0) {
        await stripe.billing.meterEvents.create({
          event_name: TEXTS_METER_EVENT,
          payload: { stripe_customer_id: customer.id, value: String(c.texts) },
          identifier: `check-billing:${clock.id}:${customer.id}`,
          // Inside period one (within five minutes of the clock's frozen time).
          timestamp: clock.frozen_time,
        });
      }
    }

    await stripe.testHelpers.testClocks.advance(clock.id, {
      frozen_time: addMonthAndDay(clock.frozen_time),
    });
    await waitFor("test clock to advance", CLOCK_TIMEOUT_MS, async () => {
      const current = await stripe.testHelpers.testClocks.retrieve(clock.id);
      return current.status === "ready" ? current : null;
    });

    const rows: Array<{ name: string; expected: string; actual: string; match: string }> = [];
    for (const { c, customerId } of subs) {
      const expected = hostedMonthlyCents({ staff: c.staff, textLine: c.textLine, texts: c.texts });
      // The renewal invoice is the second one for the customer (see header).
      const invoice = await waitFor(`renewal invoice for ${c.name}`, INVOICE_TIMEOUT_MS, async () => {
        const list = await stripe.invoices.list({ customer: customerId, limit: 10 });
        const ordered = [...list.data].sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
        const renewal = ordered[1];
        if (!renewal) return null;
        if (renewal.status === "draft") {
          await stripe.invoices.finalizeInvoice(renewal.id).catch(() => undefined);
          return null;
        }
        return renewal;
      });
      const ok = invoice.total === expected;
      if (!ok) mismatch = true;
      rows.push({
        name: c.name,
        expected: money(expected),
        actual: money(invoice.total),
        match: ok ? "yes" : "NO",
      });
    }
    console.table(rows);

    // Scratch staff check on A's subscription: the item change for 2 staff.
    const a = subs[0];
    const aSub = await stripe.subscriptions.retrieve(a.subscriptionId, {
      expand: ["items.data.price"],
    });
    const current = new Map<string, Stripe.SubscriptionItem>();
    for (const item of aSub.items.data) {
      if (item.price.lookup_key) current.set(item.price.lookup_key, item);
    }
    const extraQty = () => current.get(HOSTED_EXTRA_STAFF_MONTHLY_LOOKUP_KEY)?.quantity ?? 0;
    const before = extraQty();
    const plan = diffItems(
      new Map([...current].map(([k, item]) => [k, { id: item.id, quantity: item.quantity }])),
      desiredItems({ billableStaff: 2 }),
    );
    for (const u of plan.update) {
      await stripe.subscriptionItems.update(u.id, {
        quantity: u.quantity,
        proration_behavior: "none",
      });
    }
    const after = (
      await stripe.subscriptions.retrieve(a.subscriptionId, { expand: ["items.data.price"] })
    ).items.data.find((i) => i.price.lookup_key === HOSTED_EXTRA_STAFF_MONTHLY_LOOKUP_KEY)?.quantity ?? 0;
    const staffOk = before === 0 && after === 1;
    if (!staffOk) mismatch = true;
    console.log(`Extra staff quantity on A: ${before} -> ${after} ${staffOk ? "(ok)" : "(UNEXPECTED, wanted 0 -> 1)"}`);
  } finally {
    await stripe.testHelpers.testClocks.del(clock.id);
    console.log(`Deleted test clock ${clock.id}`);
  }

  if (mismatch) {
    console.error("Mismatch: Stripe does not bill what the calculator says.");
    process.exit(1);
  }
  console.log("All cases match.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

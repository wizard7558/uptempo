import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

/**
 * Idempotently ensures the hosted-plan Stripe catalog exists: the texts meter,
 * products, prices (by lookup key), and the default customer portal config.
 *
 *   npm run stripe:catalog            # test-mode key
 *   npm run stripe:catalog -- --live  # required for an sk_live_ key
 *
 * Prices can't change amount, so a mismatch creates a new price and moves the
 * lookup key to it (transfer_lookup_key). Existing subscriptions keep the old one.
 */
import Stripe from "stripe";
import {
  HOSTED_PRICES,
  TEXTS_METER_EVENT,
} from "../../src/lib/billing/hosted-catalog";
import {
  DESIRED_PORTAL_FEATURES,
  PORTAL_HEADLINE,
  portalMatches,
  priceMatches,
} from "./catalog-match";

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  const live = process.argv.includes("--live");
  if (!key) {
    console.error("STRIPE_SECRET_KEY is not set.");
    process.exit(1);
  }
  if (key.startsWith("sk_live_")) {
    if (!live) {
      console.error(
        "Refusing to use a live key (sk_live_). Pass --live to run against live mode.",
      );
      process.exit(1);
    }
  } else if (!key.startsWith("sk_test_")) {
    console.error("STRIPE_SECRET_KEY must start with sk_test_ or sk_live_.");
    process.exit(1);
  }

  const stripe = new Stripe(key);
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    console.log(line);
  };

  // Meter
  let meter: Stripe.Billing.Meter | undefined;
  for await (const m of stripe.billing.meters.list({
    status: "active",
    limit: 100,
  })) {
    if (m.event_name === TEXTS_METER_EVENT) {
      meter = m;
      break;
    }
  }
  if (!meter) {
    meter = await stripe.billing.meters.create({
      display_name: "Uptempo texts",
      event_name: TEXTS_METER_EVENT,
      default_aggregation: { formula: "sum" },
      customer_mapping: {
        type: "by_id",
        event_payload_key: "stripe_customer_id",
      },
      value_settings: { event_payload_key: "value" },
    });
    log(`Created meter ${meter.id} (${TEXTS_METER_EVENT})`);
  }
  const meterId = meter.id;

  // Products
  const specs = Object.entries(HOSTED_PRICES);
  for (const [, spec] of specs) {
    try {
      await stripe.products.retrieve(spec.productId);
    } catch (err) {
      if ((err as { code?: string }).code !== "resource_missing") throw err;
      await stripe.products.create({ id: spec.productId, name: spec.productName });
      log(`Created product ${spec.productId} (${spec.productName})`);
    }
  }

  // Prices
  const existing = new Map<string, Stripe.Price>();
  for await (const p of stripe.prices.list({
    lookup_keys: specs.map(([k]) => k),
    active: true,
    limit: 100,
  })) {
    if (p.lookup_key) existing.set(p.lookup_key, p);
  }
  for (const [lookupKey, spec] of specs) {
    const found = existing.get(lookupKey);
    if (found && priceMatches(spec, found, meterId)) continue;
    const params: Stripe.PriceCreateParams = {
      lookup_key: lookupKey,
      product: spec.productId,
      currency: "usd",
      unit_amount: spec.unitAmountCents,
    };
    if (spec.kind === "licensed") {
      params.recurring = { interval: "month", usage_type: "licensed" };
    } else if (spec.kind === "metered") {
      params.recurring = {
        interval: "month",
        usage_type: "metered",
        meter: meterId,
      };
    }
    if (found) params.transfer_lookup_key = true;
    const created = await stripe.prices.create(params);
    log(
      found
        ? `Replaced price for ${lookupKey}: ${found.id} -> ${created.id} (lookup key transferred)`
        : `Created price ${created.id} for ${lookupKey}`,
    );
  }

  // Customer portal (default configuration)
  const defaults = await stripe.billingPortal.configurations.list({
    is_default: true,
    limit: 1,
  });
  const current = defaults.data[0];
  if (!current) {
    const created = await stripe.billingPortal.configurations.create({
      business_profile: { headline: PORTAL_HEADLINE },
      features: DESIRED_PORTAL_FEATURES,
    });
    log(`Created portal configuration ${created.id}`);
  } else if (!portalMatches(current)) {
    await stripe.billingPortal.configurations.update(current.id, {
      features: DESIRED_PORTAL_FEATURES,
    });
    log(`Updated default portal configuration ${current.id}`);
  }

  if (lines.length === 0) {
    console.log("Created or changed nothing.");
  } else {
    console.log(`Done: ${lines.length} change(s).`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

import {
  REFERENCE_PROFILE,
  breakEvenTicketCents,
  processingMargin,
  ticketForMarginCents,
} from "../../src/lib/billing/processing-margin";

const rateBps = 500;
const fixedCents = readInt("PLATFORM_PROCESSING_FIXED_CENTS", 0);
const rate = { rateBps, fixedCents };

const tickets = [2000, 2800, 4000, 6000, 10000, 30000];

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}

console.log(
  `Card processing margin at ${rateBps} bps and ${dollars(fixedCents)} fixed`,
);
console.log(
  "Profile: $60 average ticket, 40 card payments a month, 4 weekly payouts,",
);
console.log(
  "Stripe 2.9% + $0.30, Connect $2.00 a month, payout 0.25% + $0.25.",
);
console.log("");
console.log(
  "Ticket     Collected  Stripe fee  Payout share  Connect share  Net       Net %",
);

for (const ticket of tickets) {
  const margin = processingMargin(REFERENCE_PROFILE, rate, ticket);
  const cells = [
    dollars(margin.ticketCents).padEnd(10),
    dollars(margin.feeCollectedCents).padEnd(10),
    dollars(margin.stripeChargeFeeCents).padEnd(11),
    dollars(margin.payoutShareCents).padEnd(13),
    dollars(margin.connectShareCents).padEnd(14),
    dollars(margin.netCents).padEnd(9),
    percent(margin.netPercent),
  ];
  console.log(cells.join(" "));
}

const breakEven = breakEvenTicketCents(REFERENCE_PROFILE, rate);
const half = ticketForMarginCents(REFERENCE_PROFILE, rate, 0.005);
console.log("");
console.log(
  `Break-even ticket: ${breakEven == null ? "none" : dollars(breakEven)}`,
);
console.log(
  `Ticket where the net reaches 0.5%: ${half == null ? "none" : dollars(half)}`,
);

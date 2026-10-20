import { pathToFileURL } from "node:url";
import {
  assertBillingNoticeProviderAllowed,
  closeBillingDatabase,
  countUnnotifiedPaying,
  formatBillingSwitchDate,
  getBillingNoticeRows,
  sendBillingNotice,
} from "@/lib/billing/switch";

type Arguments = {
  send: boolean;
  confirmCount: number | null;
  allowConsole: boolean;
};

function parseArguments(argv: string[]): Arguments {
  let send = false;
  let confirmCount: number | null = null;
  let allowConsole = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--send") {
      if (send) throw new Error("--send can only be provided once.");
      send = true;
    } else if (argument === "--confirm") {
      if (confirmCount !== null) {
        throw new Error("--confirm can only be provided once.");
      }
      const value = argv[index + 1];
      if (!value || !/^(0|[1-9]\d*)$/.test(value)) {
        throw new Error("--confirm requires a non-negative whole-number count.");
      }
      confirmCount = Number(value);
      if (!Number.isSafeInteger(confirmCount)) {
        throw new Error("--confirm count is outside the supported range.");
      }
      index += 1;
    } else if (argument === "--allow-console") {
      if (allowConsole) {
        throw new Error("--allow-console can only be provided once.");
      }
      allowConsole = true;
    } else {
      throw new Error(
        `Unknown argument: ${argument}. Usage: tsx scripts/billing/send-billing-notices.ts [--send --confirm <count>] [--allow-console]`,
      );
    }
  }

  if (send && confirmCount === null) {
    throw new Error("Sending requires --send --confirm <current-count>.");
  }
  if (!send && confirmCount !== null) {
    throw new Error("--confirm is only valid with --send.");
  }
  if (allowConsole && !send) {
    throw new Error("--allow-console is only valid with --send.");
  }

  return { send, confirmCount, allowConsole };
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function usagePeriod(start: string, endExclusive: string): string {
  const end = new Date(`${endExclusive}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return `${start} through ${end.toISOString().slice(0, 10)} UTC`;
}

export async function runBillingNoticeCommand(
  argv: string[],
  io: Pick<Console, "log" | "error"> = console,
): Promise<{ sent: number; skipped: number; failed: number }> {
  const args = parseArguments(argv);
  const rows = await getBillingNoticeRows();
  const count = countUnnotifiedPaying(rows);

  io.log(args.send ? "Billing notice send preview" : "Billing notice dry run");
  io.log(
    "No subscription is created or canceled by this command. Estimates are not fixed invoices.",
  );
  io.log(
    JSON.stringify(
      rows.map((row) => ({
        slug: row.slug,
        name: row.name,
        classification: row.classification,
        currentRate: row.currentRateLabel,
        activeProviders: row.activeProviders,
        observedTextPeriod: usagePeriod(
          row.textPeriodStart,
          row.textPeriodEndExclusive,
        ),
        textsObserved: row.textsObserved,
        textLineBillable: row.textLineBillable,
        estimatedMonthly: money(row.estimatedMonthlyCents),
        plannedSwitchDate: row.plannedSwitchAt
          ? formatBillingSwitchDate(row.plannedSwitchAt)
          : null,
        noticeSentAt: row.noticeSentAt?.toISOString() ?? null,
        hasExistingHostedSubscription: row.hasExistingHostedSubscription,
        recipientCount: row.recipientCount,
      })),
    ),
  );
  io.log(`Current paying tenants without a sent notice: ${count}`);

  if (!args.send) return { sent: 0, skipped: 0, failed: 0 };
  if (args.confirmCount !== count) {
    throw new Error(
      `Confirmation mismatch: expected --confirm ${count}, received ${args.confirmCount}. No notices were sent.`,
    );
  }

  // Reject unsupported providers before the first tenant is processed.
  assertBillingNoticeProviderAllowed(args.allowConsole);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.classification !== "paying" || row.noticeSentAt) continue;
    try {
      const result = await sendBillingNotice(row.slug, {
        allowConsoleForLocalTest: args.allowConsole,
      });
      if (result.status === "sent") {
        sent += 1;
        io.log(`sent ${row.slug} · switch ${formatBillingSwitchDate(result.billingSwitchAt)}`);
      } else {
        skipped += 1;
        io.log(`${result.status} ${row.slug}`);
      }
    } catch (error) {
      failed += 1;
      const detail = error instanceof Error ? error.message : "unknown error";
      io.error(`failed ${row.slug}: ${detail}`);
    }
  }

  io.log(`Completed: ${sent} sent, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) {
    throw new Error(
      `Billing notice batch had ${failed} failure(s); successful notices remain marked and failed intents remain unmarked.`,
    );
  }
  return { sent, skipped, failed };
}

async function main(): Promise<void> {
  try {
    await runBillingNoticeCommand(process.argv.slice(2));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error(`[billing notices] ${detail}`);
    process.exitCode = 1;
  } finally {
    try {
      await closeBillingDatabase();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown error";
      console.error(`[billing notices] database close failed: ${detail}`);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

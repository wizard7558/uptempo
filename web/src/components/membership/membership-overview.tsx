import Link from "next/link";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { MembershipOverviewRow } from "@/actions/membership";

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function MembershipOverview({
  memberships,
  mrrCents,
  count,
}: {
  memberships: MembershipOverviewRow[];
  mrrCents: number;
  count: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active members</CardTitle>
        <CardDescription>
          {count === 0
            ? "No active memberships yet."
            : `${count} active ${count === 1 ? "member" : "members"} · ${money(mrrCents)}/mo recurring`}
        </CardDescription>
      </CardHeader>
      {count > 0 && (
        <CardContent>
          <ul className="divide-y rounded-lg border text-sm">
            {memberships.map((m) => (
              <li
                key={m.clientId}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
              >
                <Link
                  href={`/clients/${m.clientId}`}
                  className="font-medium hover:underline"
                >
                  {m.clientName}
                </Link>
                <div className="text-right text-muted-foreground">
                  <span>
                    {m.planName} · {money(m.monthlyAmountCents)}/mo
                  </span>
                  {m.currentPeriodEnd && (
                    <span className="block text-xs">
                      Next billing{" "}
                      {format(new Date(m.currentPeriodEnd), "MMM d, yyyy")}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

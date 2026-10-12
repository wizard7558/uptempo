"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Loader2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { markOrderFulfilled, type OrderView } from "@/actions/orders";

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * A shipping address arrives as `unknown` (stored JSON). Narrow it defensively
 * and build a single-line display, returning null when nothing usable is present.
 */
function shippingAddressText(addr: unknown): string | null {
  if (typeof addr !== "object" || addr === null) return null;
  const a = addr as Record<string, unknown>;
  const pick = (key: string): string | null => {
    const value = a[key];
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  };
  const line1 = pick("line1");
  const cityStateLine = [pick("city"), pick("state")].filter(Boolean).join(", ");
  const tail = [cityStateLine, pick("postal_code")].filter(Boolean).join(" ");
  const full = [line1, tail].filter(Boolean).join(", ");
  return full.length > 0 ? full : null;
}

function OrderRow({ order }: { order: OrderView }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const customer = order.customerName ?? order.customerEmail ?? "Guest";
  const itemsSummary = order.items
    .map((item) => `${item.quantity}× ${item.name}`)
    .join(", ");
  const address =
    order.fulfillment === "ship"
      ? shippingAddressText(order.shippingAddress)
      : null;
  const fulfilled = order.status === "fulfilled";

  function markFulfilled() {
    startTransition(async () => {
      const result = await markOrderFulfilled(order.id);
      if (result.success) {
        toast.success("Order marked fulfilled.");
        router.refresh();
      } else {
        toast.error(result.message ?? "Could not update order.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{customer}</span>
          <span className="text-xs text-muted-foreground">
            {format(new Date(order.createdAt), "MMM d, yyyy")}
          </span>
        </div>
        {itemsSummary ? (
          <p className="text-sm text-muted-foreground">{itemsSummary}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Badge variant="secondary">
            {order.fulfillment === "ship" ? "Ship" : "Pickup"}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              fulfilled
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-amber-300 bg-amber-50 text-amber-700",
            )}
          >
            {fulfilled ? "Fulfilled" : "Needs fulfillment"}
          </Badge>
        </div>
        {address ? (
          <p className="text-xs text-muted-foreground">Ship to: {address}</p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
        <span className="text-sm font-semibold tabular-nums">
          {usd(order.totalCents)}
        </span>
        {order.status === "paid" ? (
          <Button
            type="button"
            
            variant="outline"
            onClick={markFulfilled}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Mark fulfilled"
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Recent storefront orders with a one-tap "mark fulfilled" action. */
export function OrdersList({ initialOrders }: { initialOrders: OrderView[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
        <CardDescription>
          Storefront purchases, newest first. Mark each order fulfilled once
          it&apos;s been picked up or shipped.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {initialOrders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ShoppingBag className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {initialOrders.map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

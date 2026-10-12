"use client";

import { useT } from "@/lib/terms/client";
import { useMemo, useState } from "react";
import { Loader2, Minus, Package, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  createStorefrontCheckout,
  type StorefrontData,
  type StorefrontProduct,
} from "@/actions/storefront";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

const MAX_QTY = 10;

/** Cents → "$X.XX". */
function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type Fulfillment = "pickup" | "ship";

export function StoreClient({
  slug,
  data,
}: {
  slug: string;
  data: StorefrontData;
}) {
  const t = useT("booking");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [fulfillment, setFulfillment] = useState<Fulfillment>("pickup");
  const [checkingOut, setCheckingOut] = useState(false);

  const getQty = (id: string) => qty[id] ?? 0;

  const changeQty = (id: string, next: number) => {
    const clamped = Math.max(0, Math.min(MAX_QTY, next));
    setQty((prev) => {
      if (clamped === 0) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: clamped };
    });
  };

  const { recommended, rest } = useMemo(() => {
    return {
      recommended: data.products.filter((p) => p.recommended),
      rest: data.products.filter((p) => !p.recommended),
    };
  }, [data.products]);

  const cart = useMemo(
    () => data.products.filter((p) => (qty[p.id] ?? 0) > 0),
    [data.products, qty],
  );

  const itemCount = cart.reduce((sum, p) => sum + (qty[p.id] ?? 0), 0);
  const subtotalCents = cart.reduce(
    (sum, p) => sum + p.priceCents * (qty[p.id] ?? 0),
    0,
  );
  const taxCents =
    data.taxBps > 0 ? Math.round((subtotalCents * data.taxBps) / 10000) : 0;
  const shipFlatCents = data.shipAvailable ? (data.shippingCents ?? 0) : 0;
  const appliedShipCents = fulfillment === "ship" ? shipFlatCents : 0;
  const totalCents = subtotalCents + taxCents + appliedShipCents;

  async function handleCheckout() {
    if (cart.length === 0) return;
    setCheckingOut(true);
    try {
      const result = await createStorefrontCheckout(slug, {
        items: cart.map((p) => ({ productId: p.id, quantity: qty[p.id] ?? 0 })),
        fulfillment,
      });
      if (result.success) {
        window.location.href = result.url;
        return; // keep the loading state through the redirect
      }
      toast.error(result.error);
      setCheckingOut(false);
    } catch {
      toast.error("Something went wrong. Please try again.");
      setCheckingOut(false);
    }
  }

  if (data.products.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--line)] px-6 py-16 text-center">
        <Package className="size-8 text-[var(--ink-soft)]" aria-hidden />
        <p className="text-sm text-[var(--ink-soft)]">
          No products are available yet. Check back soon.
        </p>
      </div>
    );
  }

  const hasRecommended = recommended.length > 0;

  return (
    <>
      <div className={cn("space-y-8", itemCount > 0 && "pb-24")}>
        {hasRecommended ? (
          <>
            <section>
              <SectionHeading>Picked for you</SectionHeading>
              <ProductGrid
                products={recommended}
                getQty={getQty}
                changeQty={changeQty}
              />
            </section>
            {rest.length > 0 && (
              <section>
                <SectionHeading>Everything else</SectionHeading>
                <ProductGrid
                  products={rest}
                  getQty={getQty}
                  changeQty={changeQty}
                />
              </section>
            )}
          </>
        ) : (
          <ProductGrid
            products={data.products}
            getQty={getQty}
            changeQty={changeQty}
          />
        )}
      </div>

      {itemCount > 0 && (
        <Drawer>
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-background">
            <div className="mx-auto flex w-full max-w-lg justify-end px-4 py-3 sm:px-6 md:max-w-2xl lg:max-w-4xl xl:max-w-6xl">
              <DrawerTrigger asChild>
                <Button
                  size="lg"
                  className="w-full justify-between gap-6 lg:w-auto lg:min-w-96"
                >
                  <span className="font-medium">
                    {itemCount} {itemCount === 1 ? "item" : "items"}
                  </span>
                  <span className="flex items-center gap-2">
                    <span>{usd(subtotalCents)}</span>
                    <span className="text-primary-foreground/70">Review</span>
                  </span>
                </Button>
              </DrawerTrigger>
            </div>
          </div>

          <DrawerContent>
            <div className="mx-auto flex w-full max-w-lg flex-col overflow-hidden">
              <DrawerHeader className="text-left">
                <DrawerTitle>Your cart</DrawerTitle>
              </DrawerHeader>

              <div className="flex-1 overflow-y-auto px-4">
                <ul className="divide-y divide-[var(--line)]">
                  {cart.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-start justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-[var(--ink)]">
                          {p.name}
                        </p>
                        <p className="text-xs text-[var(--ink-soft)]">
                          {getQty(p.id)} × {usd(p.priceCents)}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm text-[var(--ink)]">
                        {usd(p.priceCents * getQty(p.id))}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 space-y-1.5 border-t border-[var(--line)] pt-4 text-sm">
                  <Row label="Subtotal" value={usd(subtotalCents)} />
                  {data.taxBps > 0 && (
                    <Row
                      label="Estimated tax"
                      value={usd(taxCents)}
                      muted
                    />
                  )}
                </div>

                <fieldset className="mt-5 space-y-2">
                  <legend className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                    Fulfillment
                  </legend>
                  <FulfillmentOption
                    label={t("storeClient.pickup")}
                    price="Free"
                    checked={fulfillment === "pickup"}
                    onSelect={() => setFulfillment("pickup")}
                  />
                  {data.shipAvailable && (
                    <FulfillmentOption
                      label="Ship to me"
                      price={`${usd(shipFlatCents)} flat`}
                      checked={fulfillment === "ship"}
                      onSelect={() => setFulfillment("ship")}
                    />
                  )}
                </fieldset>

                <div className="mt-5 flex items-center justify-between border-t border-[var(--line)] pt-4">
                  <span className="text-base font-medium text-[var(--ink)]">
                    Total
                  </span>
                  <span className="text-base font-medium text-[var(--ink)]">
                    {usd(totalCents)}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2 p-4">
                <Button
                  size="lg"
                  className="w-full"
                  onClick={handleCheckout}
                  disabled={checkingOut}
                >
                  {checkingOut ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Redirecting…
                    </>
                  ) : (
                    `Checkout · ${usd(totalCents)}`
                  )}
                </Button>
                <DrawerClose asChild>
                  <Button variant="ghost"  className="w-full">
                    Keep shopping
                  </Button>
                </DrawerClose>
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-xs font-medium uppercase tracking-[0.16em] text-[var(--ink-soft)]">
      {children}
    </h2>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? "text-[var(--ink-soft)]" : "text-[var(--ink)]"}>
        {label}
      </span>
      <span className={muted ? "text-[var(--ink-soft)]" : "text-[var(--ink)]"}>
        {value}
      </span>
    </div>
  );
}

function FulfillmentOption({
  label,
  price,
  checked,
  onSelect,
}: {
  label: string;
  price: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between rounded-md border px-3 py-2.5 text-sm transition-colors",
        checked
          ? "border-[var(--ink)] bg-muted/40"
          : "border-[var(--line)] hover:border-[var(--ink)]",
      )}
    >
      <span className="flex items-center gap-2.5 text-[var(--ink)]">
        <input
          type="radio"
          name="fulfillment"
          className="size-4 accent-[var(--ink)]"
          checked={checked}
          onChange={onSelect}
        />
        {label}
      </span>
      <span className="text-[var(--ink-soft)]">{price}</span>
    </label>
  );
}

function ProductGrid({
  products,
  getQty,
  changeQty,
}: {
  products: StorefrontProduct[];
  getQty: (id: string) => number;
  changeQty: (id: string, next: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((p) => (
        <ProductCard
          key={p.id}
          product={p}
          quantity={getQty(p.id)}
          changeQty={changeQty}
        />
      ))}
    </div>
  );
}

function ProductCard({
  product,
  quantity,
  changeQty,
}: {
  product: StorefrontProduct;
  quantity: number;
  changeQty: (id: string, next: number) => void;
}) {
  return (
    <Card
      variant="default"
      className="gap-0 overflow-hidden py-0 transition-colors hover:border-[var(--ink)]"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {product.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.photoUrl}
            alt={product.name}
            className="size-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <Package className="size-8 text-[var(--ink-faint)]" aria-hidden />
          </div>
        )}
        {product.recommended && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium text-[var(--ink)] shadow-sm backdrop-blur">
            <Sparkles className="size-3" aria-hidden />
            Recommended for you
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        {product.brand && (
          <p className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">
            {product.brand}
          </p>
        )}
        <h3 className="text-sm font-medium leading-snug text-[var(--ink)]">
          {product.name}
        </h3>
        {product.size && (
          <p className="text-xs text-[var(--ink-soft)]">{product.size}</p>
        )}
        <p className="text-sm text-[var(--ink)]">{usd(product.priceCents)}</p>
        {product.description && (
          <p className="line-clamp-2 text-xs text-[var(--ink-soft)]">
            {product.description}
          </p>
        )}

        <div className="mt-3">
          {quantity === 0 ? (
            <Button
              variant="outline"
              
              className="w-full"
              onClick={() => changeQty(product.id, 1)}
            >
              Add to cart
            </Button>
          ) : (
            <div className="flex items-center justify-between rounded-full border border-[var(--line)] px-1">
              <button
                type="button"
                onClick={() => changeQty(product.id, quantity - 1)}
                aria-label={`Decrease quantity of ${product.name}`}
                className="flex size-8 items-center justify-center rounded-full text-[var(--ink)] transition-colors hover:bg-muted"
              >
                <Minus className="size-4" aria-hidden />
              </button>
              <span
                aria-live="polite"
                className="min-w-6 text-center text-sm font-medium text-[var(--ink)]"
              >
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => changeQty(product.id, quantity + 1)}
                disabled={quantity >= MAX_QTY}
                aria-label={`Increase quantity of ${product.name}`}
                className="flex size-8 items-center justify-center rounded-full text-[var(--ink)] transition-colors hover:bg-muted disabled:opacity-40"
              >
                <Plus className="size-4" aria-hidden />
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

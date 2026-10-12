"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Package, Loader2, ImageUp, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/terms/client";
import {
  createProduct,
  updateProduct,
  deleteProduct,
  uploadProductPhoto,
  type ProductView,
} from "@/actions/products";
import { downscaleImageFile } from "@/lib/images/downscale";

type TagOption = { value: string; label: string };

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dollarsToCents(value: string): number | null {
  const n = Number(value.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function ProductPhotoField({
  photoUrl,
  onChange,
}: {
  photoUrl: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const original = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!original) return;

    setUploading(true);
    try {
      // Shrink phone photos client-side; fall back to the original when the
      // browser can't decode the format (server caps originals at 8MB).
      const downscaled = await downscaleImageFile(original);
      const file = downscaled ?? original;

      const formData = new FormData();
      formData.append("file", file);
      if (photoUrl) formData.append("oldUrl", photoUrl);

      const result = await uploadProductPhoto(formData);
      if (result.ok) {
        onChange(result.url);
        toast.success("Photo uploaded");
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Could not upload the photo");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Field label="Photo">
      <div className="flex items-center gap-3">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-md border bg-muted">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Package className="size-5 text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ImageUp className="size-3.5" />
              )}
              {photoUrl ? "Replace photo" : "Upload photo"}
            </Button>
            {photoUrl ? (
              <Button
                type="button"
                variant="ghost"
                
                disabled={uploading}
                onClick={() => onChange("")}
                aria-label="Remove photo"
              >
                <X className="size-3.5" />
              </Button>
            ) : null}
          </div>
          <button
            type="button"
            className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setShowUrlInput((v) => !v)}
          >
            or paste an image URL
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />
      </div>
      {showUrlInput ? (
        <Input
          value={photoUrl}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
          className="mt-2"
        />
      ) : null}
    </Field>
  );
}

function ProductForm({
  product,
  tagOptions,
  onSuccess,
}: {
  product?: ProductView;
  tagOptions: TagOption[];
  onSuccess: () => void;
}) {
  const t = useT("customFields");
  const [name, setName] = useState(product?.name ?? "");
  const [brand, setBrand] = useState(product?.brand ?? "");
  const [size, setSize] = useState(product?.size ?? "");
  const [price, setPrice] = useState(
    product ? String(product.priceCents / 100) : "",
  );
  const [cost, setCost] = useState(
    product?.costCents != null ? String(product.costCents / 100) : "",
  );
  const [photoUrl, setPhotoUrl] = useState(product?.photoUrl ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [tags, setTags] = useState<string[]>(product?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const tagLabels = new Map(tagOptions.map((option) => [option.value, option.label]));
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleTag(tag: string) {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
    );
  }

  function addTag() {
    const next = tagDraft.trim();
    if (!next || next.length > 40 || tags.includes(next) || tags.length >= 20) return;
    setTags((prev) => [...prev, next]);
    setTagDraft("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (name.trim().length === 0) {
      setError("Name is required.");
      return;
    }
    const priceCents = dollarsToCents(price);
    if (priceCents === null) {
      setError("Enter a valid price.");
      return;
    }
    const costCents = cost.trim() === "" ? null : dollarsToCents(cost);
    if (cost.trim() !== "" && costCents === null) {
      setError("Enter a valid cost, or leave it blank.");
      return;
    }

    startTransition(async () => {
      const payload = {
        name,
        brand,
        size,
        priceCents,
        costCents,
        photoUrl,
        description,
        tags,
        isActive,
      };
      const result = product
        ? await updateProduct({ id: product.id, ...payload })
        : await createProduct(payload);

      if (result.success) {
        toast.success(product ? "Product updated" : "Product added");
        onSuccess();
      } else {
        setError("Could not save the product. Check the fields and try again.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Name" htmlFor="p-name">
        <Input
          id="p-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="AirWash Dry Shampoo"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Brand" htmlFor="p-brand">
          <Input
            id="p-brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="K18"
          />
        </Field>
        <Field label="Size" htmlFor="p-size">
          <Input
            id="p-size"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder="118 ml / 4 fl oz"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Retail price ($)" htmlFor="p-price">
          <Input
            id="p-price"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="32.00"
          />
        </Field>
        <Field label="Your cost ($, optional)" htmlFor="p-cost">
          <Input
            id="p-cost"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="16.00"
          />
        </Field>
      </div>

      <ProductPhotoField photoUrl={photoUrl} onChange={setPhotoUrl} />

      <Field label={t("products.tags")}>
        <p className="mb-2 text-xs text-muted-foreground">{t("products.tagsHint")}</p>
        <div className="flex flex-wrap gap-2">
          {tagOptions.map((option) => {
            const selected = tags.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleTag(option.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-foreground",
                )}
              >
                {option.label}
              </button>
            );
          })}
          {tags
            .filter((tag) => !tagLabels.has(tag))
            .map((tag) => (
              <button
                key={tag}
                type="button"
                aria-pressed
                onClick={() => toggleTag(tag)}
                className="rounded-full border border-primary bg-primary px-3 py-1 text-xs text-primary-foreground"
              >
                {tag}
              </button>
            ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            value={tagDraft}
            placeholder={t("products.tagPlaceholder")}
            onChange={(event) => setTagDraft(event.target.value)}
          />
          <Button type="button" variant="outline" onClick={addTag}>
            {t("products.addTag")}
          </Button>
        </div>
      </Field>

      <Field label="Description (optional)" htmlFor="p-desc">
        <Textarea
          id="p-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <Switch checked={isActive} onCheckedChange={setIsActive} />
        Show in storefront
      </label>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <DialogFooter>
        <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : product ? (
            "Save changes"
          ) : (
            "Add product"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ProductsClient({
  initialProducts,
  tagOptions,
}: {
  initialProducts: ProductView[];
  tagOptions: TagOption[];
}) {
  const tagLabels = new Map(tagOptions.map((option) => [option.value, option.label]));
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ProductView | null>(null);
  const [, startTransition] = useTransition();

  function handleSuccess() {
    setAddOpen(false);
    setEditing(null);
    startTransition(() => router.refresh());
  }

  async function handleDelete(product: ProductView) {
    if (!confirm(`Remove ${product.name} from your storefront?`)) return;
    const result = await deleteProduct(product.id);
    if (result.success) {
      toast.success("Product removed");
      startTransition(() => router.refresh());
    } else {
      toast.error(result.message ?? "Could not remove product");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> Add product
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add product</DialogTitle>
            </DialogHeader>
            <ProductForm tagOptions={tagOptions} onSuccess={handleSuccess} />
          </DialogContent>
        </Dialog>
      </div>

      {initialProducts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Package className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No products yet. Add the products you keep stocked to start your
              storefront.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {initialProducts.map((product) => (
            <Card key={product.id} className={cn(!product.isActive && "opacity-60")}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <div className="relative size-14 shrink-0 overflow-hidden rounded-md border bg-muted">
                    {product.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.photoUrl}
                        alt={product.name}
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center">
                        <Package className="size-5 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[product.brand, product.size].filter(Boolean).join(" · ")}
                    </p>
                    <p className="mt-1 text-sm font-semibold tabular-nums">
                      {usd(product.priceCents)}
                    </p>
                  </div>
                </div>

                {product.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {product.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {tagLabels.get(tag) ?? tag}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    
                    className="flex-1"
                    onClick={() => setEditing(product)}
                  >
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  <Button
                    variant="ghost"
                    
                    onClick={() => handleDelete(product)}
                    aria-label={`Remove ${product.name}`}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit product</DialogTitle>
          </DialogHeader>
          {editing ? (
            <ProductForm product={editing} tagOptions={tagOptions} onSuccess={handleSuccess} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

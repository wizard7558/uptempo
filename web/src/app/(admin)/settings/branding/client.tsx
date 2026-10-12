"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { updateBrandingSettings, uploadSalonLogo } from "@/actions/branding";
import { BookingPreview } from "@/components/settings/booking-preview";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, X, Loader2 } from "lucide-react";
import { useT } from "@/lib/terms/client";
import { PLATFORM_PRODUCT_NAME } from "@/lib/platform-product";
import {
  bookingThemeFromRow,
  type BookingThemeSettings,
  type ColorMode,
  type CornerStyle,
  type Density,
  type FontPairing,
} from "@/lib/booking/theme";

const HEX = /^#[0-9a-fA-F]{6}$/;

interface BrandingSettings {
  id: string;
  primaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  fontPreference: string | null;
  brandColor: string;
  fontPairing: string;
  cornerStyle: string;
  density: string;
  colorMode: string;
  showPoweredBy: number;
  createdAt: Date;
  updatedAt: Date;
}

export function BrandingSettingsForm({
  initialSettings,
  onSaved,
}: {
  initialSettings: BrandingSettings;
  /** Optional: invoked after a successful save (used by the onboarding wizard). */
  onSaved?: () => void;
}) {
  const t = useT("settings");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const initialTheme = bookingThemeFromRow(initialSettings);

  const [brandColor, setBrandColor] = useState(initialTheme.brandColor);
  const [fontPairing, setFontPairing] = useState<FontPairing>(initialTheme.fontPairing);
  const [cornerStyle, setCornerStyle] = useState<CornerStyle>(initialTheme.cornerStyle);
  const [density, setDensity] = useState<Density>(initialTheme.density);
  const [colorMode, setColorMode] = useState<ColorMode>(initialTheme.colorMode);
  const [logoUrl, setLogoUrl] = useState(initialSettings.logoUrl ?? "");
  const [showPoweredBy, setShowPoweredBy] = useState(
    initialSettings.showPoweredBy === 1
  );

  const colorReady = HEX.test(brandColor);
  const themeSettings: BookingThemeSettings = {
    brandColor: colorReady ? brandColor : initialTheme.brandColor,
    fontPairing,
    cornerStyle,
    density,
    colorMode,
  };

  function handleSave() {
    if (!colorReady) return;
    startTransition(async () => {
      const result = await updateBrandingSettings({
        brandColor,
        fontPairing,
        cornerStyle,
        density,
        colorMode,
        logoUrl: logoUrl || null,
        showPoweredBy: showPoweredBy ? 1 : 0,
      });

      if (result.success) {
        toast.success(t("branding.saved"));
        router.refresh();
        onSaved?.();
      } else {
        toast.error(t("branding.saveError"));
      }
    });
  }

  return (
    <div className="grid items-start gap-8 lg:grid-cols-2">
      <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("branding.colorLabel")}</CardTitle>
          <CardDescription>{t("branding.colorHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="brand-color">{t("branding.colorLabel")}</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={t("branding.pickColor")}
                value={colorReady ? brandColor : initialTheme.brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="size-11 cursor-pointer rounded-md border border-input"
              />
              <Input
                id="brand-color"
                value={brandColor}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                    setBrandColor(val);
                  }
                }}
                className="font-mono text-sm"
                placeholder="#B3122E"
              />
            </div>
          </div>
          <ChoiceGroup
            label={t("branding.pairingLabel")}
            value={fontPairing}
            onChange={setFontPairing}
            options={[
              { value: "score", label: t("branding.pairingScore") },
              { value: "sans", label: t("branding.pairingSans") },
            ]}
          />
          <ChoiceGroup
            label={t("branding.cornersLabel")}
            value={cornerStyle}
            onChange={setCornerStyle}
            options={[
              { value: "square", label: t("branding.cornerSquare") },
              { value: "soft", label: t("branding.cornerSoft") },
              { value: "round", label: t("branding.cornerRound") },
            ]}
          />
          <ChoiceGroup
            label={t("branding.densityLabel")}
            value={density}
            onChange={setDensity}
            options={[
              { value: "comfortable", label: t("branding.densityComfortable") },
              { value: "compact", label: t("branding.densityCompact") },
            ]}
          />
          <p className="text-xs text-muted-foreground">{t("branding.densityHelp")}</p>
          <ChoiceGroup
            label={t("branding.modeLabel")}
            value={colorMode}
            onChange={setColorMode}
            options={[
              { value: "light", label: t("branding.modeLight") },
              { value: "dark", label: t("branding.modeDark") },
            ]}
          />
          <p className="text-xs text-muted-foreground">{t("branding.modeHelp")}</p>
        </CardContent>
      </Card>

      {/* Logo */}
      <Card>
        <CardHeader>
          <CardTitle>Logo</CardTitle>
          <CardDescription>
            {t("branding.logoHelp")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LogoUploader
            logoUrl={logoUrl}
            onUpload={(url) => setLogoUrl(url)}
            onRemove={() => setLogoUrl("")}
          />
        </CardContent>
      </Card>

      {/* Platform Branding */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Platform Branding</CardTitle>
              <CardDescription>
                Control the &quot;Powered by {PLATFORM_PRODUCT_NAME}&quot; badge
                on your booking page.
              </CardDescription>
            </div>
            <Switch
              checked={showPoweredBy}
              onCheckedChange={setShowPoweredBy}
            />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Available on the Studio plan. Disable to remove platform branding
            from your booking page.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isPending || !colorReady}>
          {isPending ? t("branding.saving") : t("branding.save")}
        </Button>
      </div>
      </div>
      <BookingPreview settings={themeSettings} />
    </div>
  );
}

function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className="min-h-11 rounded-md border border-input px-3 text-sm aria-checked:bg-accent aria-checked:text-accent-foreground"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function LogoUploader({
  logoUrl,
  onUpload,
  onRemove,
}: {
  logoUrl: string;
  onUpload: (url: string) => void;
  onRemove: () => void;
}) {
  const t = useT("settings");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (logoUrl) formData.append("oldUrl", logoUrl);

      const data = await uploadSalonLogo(formData);
      if (!data.ok) {
        const hint = data.detail ? ` ${data.detail}` : "";
        toast.error(data.error + hint);
        return;
      }
      onUpload(data.url);
      toast.success("Logo uploaded");
    } catch {
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  if (logoUrl) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-center rounded-lg border bg-muted/30 p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl}
            alt={t("branding.logoAlt")}
            className="max-h-20 w-auto object-contain"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Replace
          </Button>
          <Button
            type="button"
            variant="outline"
            
            onClick={onRemove}
          >
            <X className="size-4" />
            Remove
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
          onChange={handleFileInput}
          className="hidden"
        />
      </div>
    );
  }

  return (
    <div>
      <div
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer ${
          dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
        }`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {uploading ? (
          <Loader2 className="size-8 text-muted-foreground animate-spin" />
        ) : (
          <Upload className="size-8 text-muted-foreground" />
        )}
        <p className="text-sm text-muted-foreground">
          {uploading ? "Uploading..." : "Drop your logo here or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground">
          PNG, JPG, SVG, WebP, GIF, or HEIC up to 2MB
        </p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
        onChange={handleFileInput}
        className="hidden"
      />
    </div>
  );
}

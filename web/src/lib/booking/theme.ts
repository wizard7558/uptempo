import { contrastRatio, ensureContrast, relativeLuminance } from "@/lib/utils/contrast";

/** Page backgrounds from `:root, .light` and `.dark` in globals.css. */
const PAGE_BACKGROUND = {
  light: "#FFFFFF",
  dark: "#0E0E0E",
} as const;

const RADIUS = {
  square: "0",
  soft: "0.375rem",
  round: "0.75rem",
} as const;

const MIN_CONTRAST = 4.5;
const HEX = /^#[0-9a-fA-F]{6}$/;
const FOREGROUND = ["#FFFFFF", "#0E0E0E"] as const;

export const FONT_PAIRINGS = ["score", "sans"] as const;
export const CORNER_STYLES = ["square", "soft", "round"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export const COLOR_MODES = ["light", "dark"] as const;

export type FontPairing = (typeof FONT_PAIRINGS)[number];
export type CornerStyle = (typeof CORNER_STYLES)[number];
export type Density = (typeof DENSITIES)[number];
export type ColorMode = (typeof COLOR_MODES)[number];

export interface BookingThemeSettings {
  brandColor: string;
  fontPairing: FontPairing;
  cornerStyle: CornerStyle;
  density: Density;
  colorMode: ColorMode;
}

export const DEFAULT_BOOKING_THEME: BookingThemeSettings = {
  brandColor: "#B3122E",
  fontPairing: "score",
  cornerStyle: "soft",
  density: "comfortable",
  colorMode: "light",
};

export interface BookingThemeStyle {
  style: Record<string, string>;
  className: ColorMode;
  dataDensity: Density;
}

export function bookingThemeFromRow(
  row: {
    brandColor?: string | null;
    fontPairing?: string | null;
    cornerStyle?: string | null;
    density?: string | null;
    colorMode?: string | null;
  } | null,
): BookingThemeSettings {
  const brandColor = row?.brandColor?.trim();
  return {
    brandColor: brandColor && HEX.test(brandColor) ? brandColor : DEFAULT_BOOKING_THEME.brandColor,
    fontPairing: row?.fontPairing === "sans" ? "sans" : "score",
    cornerStyle:
      row?.cornerStyle === "square" || row?.cornerStyle === "round" ? row.cornerStyle : "soft",
    density: row?.density === "compact" ? "compact" : "comfortable",
    colorMode: row?.colorMode === "dark" ? "dark" : "light",
  };
}

export function effectiveBrandColor(
  settings: Pick<BookingThemeSettings, "brandColor" | "colorMode">,
): string {
  const raw = HEX.test(settings.brandColor) ? settings.brandColor : DEFAULT_BOOKING_THEME.brandColor;
  return ensureContrast(raw, PAGE_BACKGROUND[settings.colorMode], MIN_CONTRAST);
}

function accentForeground(accent: string): string {
  let best: (typeof FOREGROUND)[number] = FOREGROUND[0];
  let bestRatio = -1;
  for (const candidate of FOREGROUND) {
    const ratio = contrastRatio(candidate, accent);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}

export function bookingThemeStyle(settings: BookingThemeSettings): BookingThemeStyle {
  const accent = effectiveBrandColor(settings);
  const style: Record<string, string> = {
    "--accent": accent,
    "--accent-foreground": accentForeground(accent),
    "--ring": accent,
    "--radius": RADIUS[settings.cornerStyle],
  };
  if (settings.fontPairing === "sans") {
    style["--font-display"] = "var(--font-hanken-grotesk)";
  }
  return {
    style,
    className: settings.colorMode,
    dataDensity: settings.density,
  };
}

export function brandColorNote(
  settings: Pick<BookingThemeSettings, "brandColor" | "colorMode">,
): "darkened" | "lightened" | null {
  if (!HEX.test(settings.brandColor)) return null;
  const effective = effectiveBrandColor(settings);
  if (effective.toUpperCase() === settings.brandColor.toUpperCase()) return null;
  return relativeLuminance(effective) < relativeLuminance(settings.brandColor)
    ? "darkened"
    : "lightened";
}

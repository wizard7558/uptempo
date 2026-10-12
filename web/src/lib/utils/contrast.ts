const HEX = /^#?[0-9a-fA-F]{6}$/;

type Rgb = { r: number; g: number; b: number };

function parseHex(hex: string): Rgb {
  const raw = hex.trim();
  if (!HEX.test(raw)) {
    throw new Error(`Expected a 6-digit hex color, received ${hex}`);
  }
  const value = raw.startsWith("#") ? raw.slice(1) : raw;
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function formatHex({ r, g, b }: Rgb): string {
  const channel = (n: number) =>
    Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0").toUpperCase();
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function srgbChannel(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  switch (max) {
    case red:
      h = (green - blue) / delta + (green < blue ? 6 : 0);
      break;
    case green:
      h = (blue - red) / delta + 2;
      break;
    default:
      h = (red - green) / delta + 4;
      break;
  }
  return { h: h / 6, s, l };
}

function hueToRgb(p: number, q: number, t: number): number {
  let hue = t;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const gray = Math.round(l * 255);
    return { r: gray, g: gray, b: gray };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, h) * 255),
    b: Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  };
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return (
    0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b)
  );
}

export function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

export function ensureContrast(hex: string, against: string, min: number): string {
  const start = formatHex(parseHex(hex));
  if (contrastRatio(start, against) >= min) return start;

  const hsl = rgbToHsl(parseHex(start));
  const againstLightness = rgbToHsl(parseHex(against)).l;
  const direction =
    hsl.l === againstLightness
      ? againstLightness >= 0.5
        ? -1
        : 1
      : hsl.l > againstLightness
        ? 1
        : -1;

  let light = Math.round(hsl.l * 100);
  let current = start;
  for (let step = 0; step < 50; step += 1) {
    light = Math.min(100, Math.max(0, light + direction * 2));
    current = formatHex(hslToRgb(hsl.h, hsl.s, light / 100));
    if (contrastRatio(current, against) >= min) return current;
    if (light === 0 || light === 100) break;
  }
  return current;
}

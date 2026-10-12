/**
 * Convert a hex color string to an HSL CSS string matching globals.css format.
 *
 * @param hex - Hex color string like "#FF5733" or "#ff5733"
 * @returns HSL CSS string like "hsl(12 84% 60%)" (space-separated, no commas)
 *
 * If the input is not a valid 6-digit hex color, returns the input string as-is.
 */
export function hexToHsl(hex: string): string {
  // Validate hex format
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return hex;
  }

  // Parse RGB values
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  // Calculate lightness
  const l = (max + min) / 2;

  // Achromatic (grey)
  if (delta === 0) {
    return `hsl(0 0% ${Math.round(l * 100)}%)`;
  }

  // Calculate saturation
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  // Calculate hue
  let h: number;
  switch (max) {
    case r:
      h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
      break;
    case g:
      h = ((b - r) / delta + 2) * 60;
      break;
    default:
      h = ((r - g) / delta + 4) * 60;
      break;
  }

  return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

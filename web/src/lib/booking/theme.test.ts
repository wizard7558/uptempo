import { describe, expect, it } from "vitest";
import { bookingThemeStyle, brandColorNote, effectiveBrandColor } from "./theme";

const base = {
  brandColor: "#B3122E",
  fontPairing: "score" as const,
  cornerStyle: "soft" as const,
  density: "comfortable" as const,
  colorMode: "light" as const,
};

describe("effectiveBrandColor", () => {
  it("keeps crimson on a light page", () => {
    expect(effectiveBrandColor({ brandColor: "#B3122E", colorMode: "light" })).toBe("#B3122E");
  });

  it("darkens pure yellow on a light page", () => {
    expect(effectiveBrandColor({ brandColor: "#FFFF00", colorMode: "light" })).toBe("#7A7A00");
  });

  it("lightens near-black on a dark page", () => {
    expect(effectiveBrandColor({ brandColor: "#1A1A1A", colorMode: "dark" })).toBe("#808080");
  });
});

describe("bookingThemeStyle", () => {
  it("uses a square corner radius of 0", () => {
    const theme = bookingThemeStyle({ ...base, cornerStyle: "square" });
    expect(theme.style["--radius"]).toBe("0");
    expect(theme.style["--accent"]).toBe("#B3122E");
    expect(theme.style["--ring"]).toBe("#B3122E");
    expect(theme.className).toBe("light");
    expect(theme.dataDensity).toBe("comfortable");
    expect(theme.style["--font-display"]).toBeUndefined();
  });

  it("maps soft and round corners and the sans display font", () => {
    expect(bookingThemeStyle({ ...base, cornerStyle: "soft" }).style["--radius"]).toBe("0.375rem");
    expect(bookingThemeStyle({ ...base, cornerStyle: "round" }).style["--radius"]).toBe("0.75rem");
    const sans = bookingThemeStyle({ ...base, fontPairing: "sans", density: "compact", colorMode: "dark" });
    expect(sans.style["--font-display"]).toBe("var(--font-hanken-grotesk)");
    expect(sans.className).toBe("dark");
    expect(sans.dataDensity).toBe("compact");
  });
});

describe("brandColorNote", () => {
  it("names the direction of a contrast change", () => {
    expect(brandColorNote({ brandColor: "#B3122E", colorMode: "light" })).toBeNull();
    expect(brandColorNote({ brandColor: "#FFFF00", colorMode: "light" })).toBe("darkened");
    expect(brandColorNote({ brandColor: "#1A1A1A", colorMode: "dark" })).toBe("lightened");
  });
});

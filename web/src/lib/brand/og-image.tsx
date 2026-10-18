import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

const LOGO_WIDTH = 640;

/** The lockup over one line of text on white, for Open Graph images. */
export async function renderOgImage(tagline: string): Promise<ImageResponse> {
  const [lockup, font] = await Promise.all([
    readFile(path.join(process.cwd(), "public/brand/lockup.svg")),
    readFile(path.join(process.cwd(), "data/brand/HankenGrotesk-Regular.ttf")),
  ]);
  const logo = `data:image/svg+xml;base64,${lockup.toString("base64")}`;
  const [, w, h] = lockup.toString("utf8").match(/width="([\d.]+)" height="([\d.]+)"/) ?? [];
  const logoHeight = Math.round((LOGO_WIDTH * Number(h)) / Number(w));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 48,
          padding: "0 80px",
          background: "#FFFFFF",
          color: "#0E0E0E",
          fontFamily: "Hanken Grotesk",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori only renders plain <img>. */}
        <img src={logo} alt="" width={LOGO_WIDTH} height={logoHeight} />
        <div style={{ fontSize: 36, color: "#5C5C5C", textAlign: "center" }}>{tagline}</div>
      </div>
    ),
    { ...OG_SIZE, fonts: [{ name: "Hanken Grotesk", data: font, weight: 400, style: "normal" }] },
  );
}

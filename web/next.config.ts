import type { NextConfig } from "next";
import path from "path";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Monorepo / multiple lockfiles: pin tracing + resolution to this app (not ~/package-lock.json).
  outputFileTracingRoot: path.join(__dirname),
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // The ZIP centroid table is read from disk at runtime, so make sure it ships with serverless bundles.
  outputFileTracingIncludes: {
    "/**": ["./data/geo/us-zip-centroids.csv"],
    "/opengraph-image": ["./data/brand/HankenGrotesk-Regular.ttf", "./public/brand/lockup.svg"],
    "/for/[industry]/opengraph-image": [
      "./data/brand/HankenGrotesk-Regular.ttf",
      "./public/brand/lockup.svg",
    ],
  },
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // The shadcn components import from the "radix-ui" umbrella package. Without
    // this, every page that renders a Button also ships Select, Tabs, Toast,
    // Dropdown Menu, and the rest of Radix.
    optimizePackageImports: ["radix-ui"],
    serverActions: {
      // Image uploads (salon logos, product photos) arrive as FormData through
      // server actions; the 1MB default rejects real phone photos.
      bodySizeLimit: "8mb",
    },
  },
  // Temporary (307) on purpose: a cached permanent redirect would 404 after a rollback.
  // Flip to permanent in Phase 2.
  async redirects() {
    return [
      { source: "/settings/stylists", destination: "/settings/staff", permanent: false },
      { source: "/settings/stylists/:staffId/services", destination: "/settings/staff/:staffId/services", permanent: false },
      { source: "/create-my-salon", destination: "/create-my-business", permanent: false },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
};

export default withNextIntl(nextConfig);

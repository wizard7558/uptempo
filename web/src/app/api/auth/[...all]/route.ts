export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { auth } = await import("@/lib/auth/server");
  const { toNextJsHandler } = await import("better-auth/next-js");
  return toNextJsHandler(auth).GET!(req);
}

export async function POST(req: Request) {
  const { auth } = await import("@/lib/auth/server");
  const { toNextJsHandler } = await import("better-auth/next-js");
  return toNextJsHandler(auth).POST!(req);
}

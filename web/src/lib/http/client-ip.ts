/** Caller IP: first x-forwarded-for entry (trimmed), else x-real-ip, else "unknown". */
export function clientIpFrom(h: Headers): string {
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

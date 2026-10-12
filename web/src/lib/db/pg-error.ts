export type PgErrorInfo = { code?: string; constraint?: string };

/**
 * Walks DrizzleQueryError -> cause. Drizzle wraps driver errors, and postgres-js
 * puts `code` / `constraint_name` on the inner driver error.
 */
export function pgErrorInfo(err: unknown): PgErrorInfo {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const e = cur as {
      code?: unknown;
      constraint_name?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (typeof e.code === "string") {
      const c =
        typeof e.constraint_name === "string"
          ? e.constraint_name
          : typeof e.constraint === "string"
            ? e.constraint
            : undefined;
      return { code: e.code, constraint: c };
    }
    cur = e.cause;
  }
  return {};
}

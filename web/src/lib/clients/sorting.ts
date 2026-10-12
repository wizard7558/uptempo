export const CLIENT_SORT_KEYS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "appointmentsBooked",
  "customerSince",
] as const;

export type ClientSortKey = (typeof CLIENT_SORT_KEYS)[number];
export type ClientSortDirection = "asc" | "desc";

export const DEFAULT_CLIENT_SORT_KEY: ClientSortKey = "firstName";
export const DEFAULT_CLIENT_SORT_DIRECTION: ClientSortDirection = "asc";

const clientSortKeySet = new Set<string>(CLIENT_SORT_KEYS);

function getSingleValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function normalizeClientSort(options: {
  sortBy?: string | string[];
  sortDir?: string | string[];
} = {}) {
  const rawSortBy = getSingleValue(options.sortBy);
  const rawSortDir = getSingleValue(options.sortDir);

  const sortBy = rawSortBy && clientSortKeySet.has(rawSortBy)
    ? (rawSortBy as ClientSortKey)
    : DEFAULT_CLIENT_SORT_KEY;
  const sortDir: ClientSortDirection = rawSortDir === "desc" ? "desc" : "asc";

  return { sortBy, sortDir };
}

export function getNextClientSortDirection(
  currentSortBy: ClientSortKey,
  currentSortDir: ClientSortDirection,
  nextSortBy: ClientSortKey,
): ClientSortDirection {
  if (currentSortBy === nextSortBy) {
    return currentSortDir === "asc" ? "desc" : "asc";
  }

  return "asc";
}

export function clientsPageHref(options: {
  query?: string;
  page?: number;
  sortBy?: ClientSortKey;
  sortDir?: ClientSortDirection;
  attributeKey?: string;
  attributeValue?: string;
} = {}): string {
  const {
    query = "",
    page = 1,
    sortBy = DEFAULT_CLIENT_SORT_KEY,
    sortDir = DEFAULT_CLIENT_SORT_DIRECTION,
    attributeKey = "",
    attributeValue = "",
  } = options;
  const params = new URLSearchParams();
  const trimmedQuery = query.trim();

  if (trimmedQuery) {
    params.set("q", trimmedQuery);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  if (
    sortBy !== DEFAULT_CLIENT_SORT_KEY ||
    sortDir !== DEFAULT_CLIENT_SORT_DIRECTION
  ) {
    params.set("sort", sortBy);
  }

  if (sortDir !== DEFAULT_CLIENT_SORT_DIRECTION) {
    params.set("dir", sortDir);
  }

  if (attributeKey) {
    params.set("f", attributeKey);
  }

  if (attributeKey && attributeValue) {
    params.set("v", attributeValue);
  }

  const queryString = params.toString();
  return queryString ? `/clients?${queryString}` : "/clients";
}

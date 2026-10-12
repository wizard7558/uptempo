"use client";

import { createAuthClient } from "better-auth/react";

// Do NOT set baseURL here. This client runs in the browser, and the app is
// served from both the apex and www hosts. Pinning baseURL to
// NEXT_PUBLIC_APP_URL would make auth calls cross-origin on the other domain
// and fail CORS/network filtering. Leaving it unset makes better-auth default
// to the current origin, so auth requests are always same-origin. The server's
// trustedOrigins covers every supported host.
export const authClient = createAuthClient({});

export const { signIn, signOut, useSession } = authClient;

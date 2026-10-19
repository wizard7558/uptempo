import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Static authorization check for server actions.
 *
 * Every exported async function in a `"use server"` file under `src/actions`
 * is a publicly callable HTTP endpoint (Next.js exposes the action ID to any
 * client), so each one must either call an approved guard, be listed in
 * PUBLIC_ACTIONS with a reason, or be listed in KNOWN_UNGUARDED (security
 * debt that only shrinks). See the hotfix plan for the migration order.
 */

const ACTIONS_DIR = __dirname;

/** Calls that count as an authorization guard inside an action body. */
const GUARD_CALLS = new Set([
  "requireStaff",
  "requireRole",
  "requireAdminRole",
  "requireBookingSessionClient",
  "getBookingSession",
]);

/** Intentionally public actions: "file#fn" -> why it is safe to expose. */
const PUBLIC_ACTIONS: Record<string, string> = {
  "booking-public.ts#getBusinessBySlug":
    "public catalog: business id/name by slug (booking page entry)",
  "booking-public.ts#getBookingStaff":
    "public catalog: active staff for the booking host; tenant from the middleware header on /book paths",
  "booking-public.ts#servicesNeedAddress":
    "public booking read: whether the selected services need an address",
  "branding.ts#getBrandingForBooking":
    "public booking-page branding",
  "calendar-sync.ts#getExternalEventsForDay":
    "public booking: cached external busy blocks for a staff member, no client data",
  "calendar-sync.ts#isExternalSlotAvailable":
    "public booking: live free/busy check, no client data",
  "classes-public.ts#listPublicClasses":
    "public catalog: upcoming classes for the booking host",
  "classes-public.ts#getClassAgeGate":
    "public class page: age requirement for one class session, no client record",
  "forms.ts#getFormsForServices":
    "public booking flow: form templates required for selected services, no client responses",
  "forms.ts#getFormResponseForToken":
    "signed HMAC token (verifyActionToken, action=form); tenant from the token's appointment",
  "forms.ts#submitFormResponse":
    "signed HMAC token (verifyActionToken, action=form) must match formResponseId",
  "forms.ts#uploadIdPhoto":
    "signed HMAC token (verifyActionToken, action=form) must match formResponseId",
  "locations.ts#listActiveLocations":
    "public catalog: active location name/address",
  "locations.ts#getStaffLocations":
    "public catalog: a staff member's location names/addresses",
  "membership.ts#listActiveMembershipPlansPublic":
    "public catalog: active membership plans for /subscribe/<slug>",
  "on-site.ts#checkPostalCodePublic":
    "public booking read: whether a postal code is inside the host's travel area",
  "onboarding.ts#checkSlugAvailability":
    "public signup: validated slug availability check",
  "onboarding.ts#createBusinessAccount":
    "public signup: creates a new user and tenant",
  "onboarding.ts#setupBusinessForOAuthUser":
    "session-only (checks getSession): provisions a new business for the signed-in user, not an existing tenant",
  "onboarding.ts#createAdditionalBusinessAsOwner":
    "session-only (checks getSession): creates another business for the signed-in user, refuses a slug that already exists",
  "owner-account.ts#deleteMyOwnerAccount":
    "session-only (checks getSession): deletes the caller's own account",
  "packages.ts#listPackagesPublic":
    "public catalog: packages offered by the booking host",
  "policies.ts#getIntakeByToken":
    "signed HMAC token (verifyActionToken, action=intake)",
  "policies.ts#createIntakeSetupIntent":
    "signed HMAC token via getIntakeByToken; returns an error when the token does not verify",
  "policies.ts#finalizeIntake":
    "signed HMAC token via getIntakeByToken; returns an error when the token does not verify",
  "projects.ts#getProjectForClient":
    "public project link: slug plus unguessable access token; returns null when the token does not match",
  "projects.ts#approveDesign":
    "public project link: approves only the project whose access token matches",
  "queue-public.ts#getQueueJoinInfo":
    "public queue page for a salon slug; live line details require the kiosk token",
  "queue-public.ts#joinQueue":
    "public queue join for a published salon slug; the leave token is stored only as a hash",
  "queue-public.ts#leaveQueue":
    "public queue leave: slug plus the unguessable public token, compared as a hash",
  "quiz.ts#submitQuizResponse":
    "public marketing form stored in the platform quiz table, not a tenant schema",
  "quotes-public.ts#getQuoteForPage":
    "public quote page: 32-character token, host tenant from the booking header",
  "quotes-public.ts#getQuoteDays":
    "public quote page: bookable days for a 32-character quote token",
  "quotes-public.ts#getQuoteSlots":
    "public quote page: bookable times for a 32-character quote token",
  "quotes-public.ts#acceptQuote":
    "quote token authorizes accepting that quote in the host tenant",
  "quotes-public.ts#declineQuote":
    "quote token authorizes declining that quote in the host tenant",
  "service-addons.ts#getAllServiceAddonsMap":
    "public catalog: service-to-add-on id map",
  "service-categories.ts#listServiceCategories":
    "public catalog: active category names for the booking service step",
  "storefront.ts#getOrderConfirmation":
    "public: Stripe session id must carry matching storefront_order and tenantSlug metadata",
  "gift-cards-public.ts#getGiftCardShopInfo":
    "public gift card page for /gift/:slug; business name and whether online purchase is open",
  "gift-cards-public.ts#startGiftCardPurchase":
    "public purchase start; IP rate limit, honeypot, and amount bounds; returns a Stripe Checkout URL only",
  "gift-cards-public.ts#getGiftCardPurchaseStatus":
    "public success page; session must carry gift_card_purchase and this slug; email is masked; the code is never returned",
  "gift-cards-public.ts#checkGiftCardBalance":
    "public balance check; IP rate limit; invalid, unknown, and cancelled codes share one error",
  "team.ts#getInvitationByToken":
    "invitation token lookup (unguessable token, expiry and status checked)",
  "team.ts#acceptInvitation":
    "invitation token; creates the invited user's account",
  "team.ts#joinBusinessFromInvitation":
    "invitation token plus signed-in session",
  "team.ts#listUserMemberships":
    "session-only (checks getSession): the caller's own memberships",
  "team.ts#switchActiveTenant":
    "session-only (checks getSession): requires the caller's own membership in the target tenant",
  "waitlist.ts#joinWaitlist":
    "public marketing form on the platform waitlist, not a tenant schema",
  "setup.ts#createSingleBusiness":
    "first-run install in single mode only; refused once a business exists and refused in multi mode",
  "slot-waitlist-public.ts#loadWaitlistClaim":
    "offer link token (hashed) on /book/:slug/claim; middleware sets the tenant from the path",
  "slot-waitlist-public.ts#claimWaitlistOffer":
    "same offer token; books the held slot and ignores that hold",
  "slot-waitlist-public.ts#declineWaitlistOffer":
    "same offer token; releases the hold so the next person can be offered",
  "slot-waitlist-public.ts#leaveSlotWaitlist":
    "same offer token; cancels that waitlist row",
};

/** Currently unguarded exports. Fix them and delete the entry; never add. */
const KNOWN_UNGUARDED = new Set<string>([]);

type ExportInfo = { key: string; guarded: boolean };

function hasUseServerDirective(sf: ts.SourceFile): boolean {
  for (const stmt of sf.statements) {
    if (
      ts.isExpressionStatement(stmt) &&
      ts.isStringLiteral(stmt.expression)
    ) {
      if (stmt.expression.text === "use server") return true;
      continue;
    }
    break;
  }
  return false;
}

function callsGuard(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;
      if (name && GUARD_CALLS.has(name)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ??
      false)
  );
}

/** Every exported function in a "use server" file, with whether it is guarded. */
function scanFile(file: string): ExportInfo[] {
  const text = fs.readFileSync(path.join(ACTIONS_DIR, file), "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (!hasUseServerDirective(sf)) return [];

  const out: ExportInfo[] = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && hasExportModifier(stmt)) {
      if (!stmt.name || !stmt.body) continue;
      out.push({
        key: `${file}#${stmt.name.text}`,
        guarded: callsGuard(stmt.body),
      });
    } else if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const init = decl.initializer;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          out.push({
            key: `${file}#${decl.name.text}`,
            guarded: callsGuard(init.body),
          });
        }
      }
    }
  }
  return out;
}

/** `export { ... }`, `export type { ... }`, and `export * from` statements in a "use server" file. */
function scanExportLists(file: string): string[] {
  const text = fs.readFileSync(path.join(ACTIONS_DIR, file), "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (!hasUseServerDirective(sf)) return [];
  return sf.statements
    .filter(ts.isExportDeclaration)
    .map((stmt) => `${file}: ${stmt.getText(sf)}`);
}

const actionFiles = fs
  .readdirSync(ACTIONS_DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .sort();

const exportsFound = actionFiles.flatMap(scanFile);
const byKey = new Map(exportsFound.map((e) => [e.key, e]));

describe("server action guards", () => {
  it("finds the actions to check", () => {
    expect(exportsFound.length).toBeGreaterThan(50);
  });

  it("every exported action is guarded, public, or in the debt list", () => {
    const offenders = exportsFound
      .filter(
        (e) =>
          !e.guarded && !(e.key in PUBLIC_ACTIONS) && !KNOWN_UNGUARDED.has(e.key),
      )
      .map((e) => e.key);
    expect(
      offenders,
      `Unguarded server actions (call requireStaff/requireRole/... or list in PUBLIC_ACTIONS with a reason):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("KNOWN_UNGUARDED only lists exports that exist", () => {
    const missing = [...KNOWN_UNGUARDED].filter((k) => !byKey.has(k));
    expect(missing, `Stale entries (remove them):\n${missing.join("\n")}`).toEqual(
      [],
    );
  });

  it("KNOWN_UNGUARDED has no entry that is already guarded (list can only shrink)", () => {
    const nowGuarded = [...KNOWN_UNGUARDED].filter((k) => byKey.get(k)?.guarded);
    expect(
      nowGuarded,
      `Already guarded, remove from KNOWN_UNGUARDED:\n${nowGuarded.join("\n")}`,
    ).toEqual([]);
  });

  it("PUBLIC_ACTIONS only lists exports that exist, with a reason", () => {
    const missing = Object.keys(PUBLIC_ACTIONS).filter((k) => !byKey.has(k));
    expect(missing, `Stale PUBLIC_ACTIONS entries:\n${missing.join("\n")}`).toEqual([]);
    const noReason = Object.entries(PUBLIC_ACTIONS)
      .filter(([, why]) => !why.trim())
      .map(([k]) => k);
    expect(noReason).toEqual([]);
  });

  it("use server files have no export lists", () => {
    // Turbopack's dev action loader re-exports every listed name as an action,
    // types included, and fails the page build when the name has no value.
    const lists = actionFiles.flatMap(scanExportLists);
    expect(
      lists,
      `Import these types from the module that defines them:\n${lists.join("\n")}`,
    ).toEqual([]);
  });

  it("PUBLIC_ACTIONS and KNOWN_UNGUARDED do not overlap", () => {
    const both = [...KNOWN_UNGUARDED].filter((k) => k in PUBLIC_ACTIONS);
    expect(both).toEqual([]);
  });

  it("reports the debt count", () => {
    const byFile = new Map<string, number>();
    for (const k of KNOWN_UNGUARDED) {
      const f = k.split("#")[0];
      byFile.set(f, (byFile.get(f) ?? 0) + 1);
    }
    const lines = [...byFile.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([f, n]) => `  ${f}: ${n}`);
    console.log(
      `[action-guards] KNOWN_UNGUARDED: ${KNOWN_UNGUARDED.size} of ${exportsFound.length} exported actions ` +
        `(${Object.keys(PUBLIC_ACTIONS).length} public)\n${lines.join("\n")}`,
    );
    expect(KNOWN_UNGUARDED.size).toBeGreaterThanOrEqual(0);
  });
});

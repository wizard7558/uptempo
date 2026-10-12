import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const teamInvitations = pgTable(
  "team_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantSlug: text("tenant_slug").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull(), // "owner" | "admin" | "provider"
    invitedBy: text("invited_by").notNull(), // user.id of the inviter
    token: text("token").notNull(),
    status: text("status").notNull().default("pending"), // pending | accepted | expired | revoked
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("team_invitations_token_unique").on(table.token),
    index("team_invitations_email_tenant_idx").on(
      table.email,
      table.tenantSlug,
    ),
    index("team_invitations_tenant_status_idx").on(
      table.tenantSlug,
      table.status,
    ),
  ],
);

import { pgTable, uuid, text, timestamp, uniqueIndex, index, integer } from "drizzle-orm/pg-core";

export const domainMappings = pgTable("domain_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantSlug: text("tenant_slug").notNull(),
  domain: text("domain").notNull(),
  type: text("type").notNull().default("custom"), // 'subdomain' | 'custom'
  verificationStatus: text("verification_status").notNull().default("pending"),
  // pending | verified | failed
  sslStatus: text("ssl_status").notNull().default("pending"),
  // pending | active | error
  stripeRegistered: text("stripe_registered").notNull().default("pending"),
  // pending | active | failed
  isPrimary: integer("is_primary").notNull().default(0),
  // 0 | 1 -- whether this is the canonical domain for the tenant
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("domain_mappings_domain_unique").on(table.domain),
  index("domain_mappings_tenant_slug_idx").on(table.tenantSlug),
]);

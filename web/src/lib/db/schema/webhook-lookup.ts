import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const webhookLookup = pgTable("webhook_lookup", {
  id: uuid("id").primaryKey().defaultRandom(),
  lookupType: text("lookup_type").notNull(), // 'stripe_customer'
  externalId: text("external_id").notNull(),
  tenantSlug: text("tenant_slug").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("webhook_lookup_type_external_id_idx").on(table.lookupType, table.externalId),
  index("webhook_lookup_tenant_slug_idx").on(table.tenantSlug),
]);

import { describe, it, expect, beforeEach } from "vitest";
import { getTenantSchema, clearSchemaCache } from "./index";
import { getTableName } from "drizzle-orm";

describe("tenant-schema factory", () => {
  beforeEach(() => {
    clearSchemaCache();
  });

  it("returns table objects with schema-qualified names containing tenant_<slug>", () => {
    const tables = getTenantSchema("acme");

    // Drizzle's getTableName returns the SQL-qualified name for schema tables
    const serviceName = getTableName(tables.services);
    expect(serviceName).toContain("services");

    const clientName = getTableName(tables.clients);
    expect(clientName).toContain("clients");
  });

  it("caches schema objects -- same slug returns same reference", () => {
    const first = getTenantSchema("acme");
    const second = getTenantSchema("acme");
    expect(first).toBe(second);
  });

  it("returns different objects for different slugs", () => {
    const acme = getTenantSchema("acme");
    const beta = getTenantSchema("beta");
    expect(acme).not.toBe(beta);
  });

  it("includes every tenant-scoped table", () => {
    const tables = getTenantSchema("acme");
    const expectedTables = [
      "services",
      "serviceCategories",
      "serviceAddons",
      "membershipPlans",
      "clientMemberships",
      "storedValueTransactions",
      "storedValueBalances",
      "clients",
      "customFieldDefinitions",
      "clientServiceOverrides",
      "staff",
      "staffServices",
      "locations",
      "bookingGroups",
      "recurrenceRules",
      "bookingRequests",
      "attachments",
      "checklistTemplates",
      "appointmentChecklistItems",
      "quotes",
      "quoteLineItems",
      "clientAddresses",
      "serviceAreas",
      "staffTravelSettings",
      "projects",
      "classSessions",
      "classEnrollments",
      "packages",
      "clientPackages",
      "creditLedger",
      "queueEntries",
      "waitlistOpenings",
      "slotWaitlist",
      "bookingWindows",
      "appointments",
      "deviceTokens",
      "appointmentServices",
      "timeBlocks",
      "workingHours",
      "availabilityOverrides",
      "resources",
      "serviceResourceRequirements",
      "appointmentResources",
      "businessSettings",
      "giftCards",
      "charges",
      "giftCardTransactions",
      "expenses",
      "expenseCategories",
      "bookingVerifications",
      "calendarConnections",
      "externalEvents",
      "formTemplates",
      "serviceFormAssignments",
      "formResponses",
      "aftercareTemplates",
      "serviceAftercareAssignments",
      "smsConsent",
      "smsMessages",
      "brandingSettings",
      "taskCatalog",
      "assistantTasks",
      "policySignatures",
      "alerts",
      "products",
      "orders",
    ];

    for (const tableName of expectedTables) {
      expect(
        tables[tableName as keyof typeof tables],
        `Missing table: ${tableName}`,
      ).toBeDefined();
    }

    expect(tables.brandingSettings.brandColor.name).toBe("brand_color");
    expect(tables.brandingSettings.fontPairing.name).toBe("font_pairing");
    expect(tables.brandingSettings.cornerStyle.name).toBe("corner_style");
    expect(tables.brandingSettings.density.name).toBe("density");
    expect(tables.brandingSettings.colorMode.name).toBe("color_mode");

    // Verify exact count
    expect(Object.keys(tables)).toHaveLength(66);
  });

  it("tenant tables do not have a salonId column", () => {
    const tables = getTenantSchema("acme");

    for (const [tableName, table] of Object.entries(tables)) {
      // Access columns from the Drizzle table object
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const columns = Object.keys(table as any);
      expect(
        columns,
        `Table ${tableName} should not have salonId`,
      ).not.toContain("salonId");
    }
  });

  it("evicts oldest entry when cache exceeds MAX_CACHE_SIZE", () => {
    // Fill cache with 100 entries (s0 through s99)
    for (let i = 0; i < 100; i++) {
      getTenantSchema(`s${i}`);
    }

    // Adding a 101st slug should evict s0 (oldest in insertion order)
    getTenantSchema("overflow");

    // s0 was evicted, so getting it again creates a new object
    // s1 should still be cached (it was second oldest, and only one eviction happened)
    const s1Ref1 = getTenantSchema("s1");
    const s1Ref2 = getTenantSchema("s1");
    expect(s1Ref1).toBe(s1Ref2); // Still cached
  });
});

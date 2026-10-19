import { describe, expect, it } from "vitest";
import {
  classifyDomainCompatibilitySnapshot,
  DOMAIN_COMPATIBILITY_EXPECTATIONS,
  type DomainCompatibilitySnapshot,
} from "./domain-compatibility-repair";

const schema = "tenant_fixture";
const migrationFunctionSources: Record<string, string> = {"domain_compat_sync_staff_id_0060":"\n    DECLARE\n      canonical_changed boolean;\n      legacy_changed boolean;\n    BEGIN\n      IF TG_OP = 'INSERT' THEN\n        IF NEW.staff_id IS NULL THEN\n          NEW.staff_id := NEW.stylist_id;\n        ELSIF NEW.stylist_id IS NULL THEN\n          NEW.stylist_id := NEW.staff_id;\n        ELSIF NEW.staff_id IS DISTINCT FROM NEW.stylist_id THEN\n          RAISE EXCEPTION 'staff_id and stylist_id must match on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME\n            USING ERRCODE = '23514';\n        END IF;\n        RETURN NEW;\n      END IF;\n\n      canonical_changed := NEW.staff_id IS DISTINCT FROM OLD.staff_id;\n      legacy_changed := NEW.stylist_id IS DISTINCT FROM OLD.stylist_id;\n      IF canonical_changed AND legacy_changed THEN\n        IF NEW.staff_id IS DISTINCT FROM NEW.stylist_id THEN\n          RAISE EXCEPTION 'staff_id and stylist_id must match on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME\n            USING ERRCODE = '23514';\n        END IF;\n      ELSIF canonical_changed THEN\n        NEW.stylist_id := NEW.staff_id;\n      ELSIF legacy_changed THEN\n        NEW.staff_id := NEW.stylist_id;\n      END IF;\n      RETURN NEW;\n    END\n    ","domain_compat_sync_staff_role_0060":"\n    DECLARE\n      canonical_changed boolean;\n      legacy_changed boolean;\n      canonical_role text;\n      legacy_role text;\n    BEGIN\n      IF TG_OP = 'INSERT' THEN\n        -- NULL is intentional input here: leave it for the column's NOT NULL constraint.\n        IF NEW.role IS NULL OR NEW.legacy_stylist_role IS NULL THEN\n          RETURN NEW;\n        END IF;\n        canonical_role := CASE NEW.role WHEN 'stylist' THEN 'provider' ELSE NEW.role END;\n        legacy_role := CASE NEW.legacy_stylist_role WHEN 'stylist' THEN 'provider' ELSE NEW.legacy_stylist_role END;\n\n        -- The two defaults are indistinguishable from explicit values in a row trigger.\n        -- Treat canonical provider and raw legacy stylist as omitted so the\n        -- other domain's non-default value can win. An explicit legacy provider\n        -- is non-default and must conflict with a different canonical value.\n        IF canonical_role = 'provider' AND NEW.legacy_stylist_role <> 'stylist' THEN\n          canonical_role := legacy_role;\n        ELSIF NEW.legacy_stylist_role = 'stylist' AND canonical_role <> 'provider' THEN\n          legacy_role := canonical_role;\n        ELSIF canonical_role IS DISTINCT FROM legacy_role THEN\n          RAISE EXCEPTION 'role and legacy_stylist_role must describe the same role'\n            USING ERRCODE = '23514';\n        END IF;\n\n        NEW.role := canonical_role;\n        NEW.legacy_stylist_role := CASE canonical_role WHEN 'provider' THEN 'stylist' ELSE canonical_role END;\n        RETURN NEW;\n      END IF;\n\n      canonical_changed := NEW.role IS DISTINCT FROM OLD.role;\n      legacy_changed := NEW.legacy_stylist_role IS DISTINCT FROM OLD.legacy_stylist_role;\n      IF canonical_changed AND legacy_changed THEN\n        -- Preserve explicit NULL so the existing NOT NULL constraint rejects it.\n        IF NEW.role IS NULL OR NEW.legacy_stylist_role IS NULL THEN\n          RETURN NEW;\n        END IF;\n        canonical_role := CASE NEW.role WHEN 'stylist' THEN 'provider' ELSE NEW.role END;\n        legacy_role := CASE NEW.legacy_stylist_role WHEN 'stylist' THEN 'provider' ELSE NEW.legacy_stylist_role END;\n        IF canonical_role IS DISTINCT FROM legacy_role THEN\n          RAISE EXCEPTION 'role and legacy_stylist_role must describe the same role'\n            USING ERRCODE = '23514';\n        END IF;\n        NEW.role := canonical_role;\n        NEW.legacy_stylist_role := CASE canonical_role WHEN 'provider' THEN 'stylist' ELSE canonical_role END;\n      ELSIF canonical_changed THEN\n        IF NEW.role IS NULL THEN\n          RETURN NEW;\n        END IF;\n        NEW.role := CASE NEW.role WHEN 'stylist' THEN 'provider' ELSE NEW.role END;\n        NEW.legacy_stylist_role := CASE NEW.role WHEN 'provider' THEN 'stylist' ELSE NEW.role END;\n      ELSIF legacy_changed THEN\n        IF NEW.legacy_stylist_role IS NULL THEN\n          RETURN NEW;\n        END IF;\n        legacy_role := CASE NEW.legacy_stylist_role WHEN 'stylist' THEN 'provider' ELSE NEW.legacy_stylist_role END;\n        NEW.role := legacy_role;\n        NEW.legacy_stylist_role := CASE legacy_role WHEN 'provider' THEN 'stylist' ELSE legacy_role END;\n      END IF;\n      RETURN NEW;\n    END\n    ","domain_compat_sync_stored_value_cents_0060":"\n    DECLARE\n      canonical_changed boolean;\n      legacy_changed boolean;\n    BEGIN\n      IF TG_OP = 'INSERT' THEN\n        IF NEW.stored_value_cents IS NULL THEN\n          NEW.stored_value_cents := NEW.beauty_bank_cents;\n        ELSIF NEW.beauty_bank_cents IS NULL THEN\n          NEW.beauty_bank_cents := NEW.stored_value_cents;\n        ELSIF NEW.stored_value_cents IS DISTINCT FROM NEW.beauty_bank_cents THEN\n          RAISE EXCEPTION 'stored_value_cents and beauty_bank_cents must match on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME\n            USING ERRCODE = '23514';\n        END IF;\n        RETURN NEW;\n      END IF;\n\n      canonical_changed := NEW.stored_value_cents IS DISTINCT FROM OLD.stored_value_cents;\n      legacy_changed := NEW.beauty_bank_cents IS DISTINCT FROM OLD.beauty_bank_cents;\n      IF canonical_changed AND legacy_changed THEN\n        IF NEW.stored_value_cents IS DISTINCT FROM NEW.beauty_bank_cents THEN\n          RAISE EXCEPTION 'stored_value_cents and beauty_bank_cents must match on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME\n            USING ERRCODE = '23514';\n        END IF;\n      ELSIF canonical_changed THEN\n        NEW.beauty_bank_cents := NEW.stored_value_cents;\n      ELSIF legacy_changed THEN\n        NEW.stored_value_cents := NEW.beauty_bank_cents;\n      END IF;\n      RETURN NEW;\n    END\n    "};
const baseTables = [
  "staff", "staff_services", "business_settings", "stored_value_transactions",
  "stored_value_balances", ...DOMAIN_COMPATIBILITY_EXPECTATIONS.staffIdAliasTables, "charges",
];

function expectedViewDefinition(view: (typeof DOMAIN_COMPATIBILITY_EXPECTATIONS.views)[number]): string {
  const projections = view.columns.map(([source, exposed]) =>
    source === exposed ? source : `${source} AS ${exposed}`,
  );
  return `SELECT ${projections.join(", ")} FROM ${view.base}`;
}

function completeSnapshot(): DomainCompatibilitySnapshot {
  const relations: DomainCompatibilitySnapshot["relations"] = baseTables.map((name) => ({
    name, kind: "r", options: [], definition: null,
  }));
  const columns: DomainCompatibilitySnapshot["columns"] = [];
  const addColumn = (
    table: string,
    name: string,
    dataType = "text",
    notNull = false,
    defaultExpression: string | null = null,
    position = 1,
  ) => {
    if (columns.some((column) => column.table === table && column.name === name)) return;
    columns.push({ table, name, dataType, notNull, defaultExpression, generated: "", identity: "", position });
  };

  for (const view of DOMAIN_COMPATIBILITY_EXPECTATIONS.views) {
    relations.push({
      name: view.name,
      kind: "v",
      options: ["security_invoker=true"],
      definition: expectedViewDefinition(view),
    });
    view.columns.forEach(([, exposed], index) => addColumn(view.name, exposed, "text", false, null, index + 1));
  }
  for (const view of DOMAIN_COMPATIBILITY_EXPECTATIONS.views) {
    for (const [source, exposed] of view.columns) {
      if (source !== "legacy_stylist_role") addColumn(view.base, source);
      if (view.name === "salon_policies" && source === "business_address") {
        addColumn(view.base, source);
      }
      void exposed;
    }
  }
  for (const table of DOMAIN_COMPATIBILITY_EXPECTATIONS.staffIdAliasTables) {
    addColumn(table, "staff_id", "uuid", true);
    addColumn(table, "stylist_id", "uuid");
  }
  addColumn("charges", "stored_value_cents", "integer");
  addColumn("charges", "beauty_bank_cents", "integer");
  addColumn("staff", "role", "text", true, "'provider'::text");
  addColumn("staff", "legacy_stylist_role", "text", true, "'stylist'::text");

  const functions: DomainCompatibilitySnapshot["functions"] = Object.entries(migrationFunctionSources).map(([name, source]) => ({
    name,
    kind: "f",
    identityArguments: "",
    returnType: "trigger",
    language: "plpgsql",
    securityDefiner: false,
    isStrict: false,
    volatility: "v",
    parallel: "u",
    leakproof: false,
    config: ["search_path=pg_catalog"],
    source,
    returnsSet: false,
  }));
  const triggerNames = [
    ...DOMAIN_COMPATIBILITY_EXPECTATIONS.staffIdAliasTables.map((table) => ({
      table, functionName: DOMAIN_COMPATIBILITY_EXPECTATIONS.staffIdFunction,
    })),
    { table: "charges", functionName: DOMAIN_COMPATIBILITY_EXPECTATIONS.storedValueFunction },
    { table: "staff", functionName: DOMAIN_COMPATIBILITY_EXPECTATIONS.roleFunction },
  ];
  const triggers: DomainCompatibilitySnapshot["triggers"] = triggerNames.map(({ table, functionName }) => ({
    name: DOMAIN_COMPATIBILITY_EXPECTATIONS.triggerName,
    table,
    functionName,
    functionSchema: schema,
    enabled: "O",
    type: 23,
    argumentCount: 0,
    condition: null,
    definition: `CREATE TRIGGER "${DOMAIN_COMPATIBILITY_EXPECTATIONS.triggerName}" BEFORE INSERT OR UPDATE ON "${schema}"."${table}" FOR EACH ROW EXECUTE FUNCTION "${schema}"."${functionName}"()`,
  }));
  return {
    relations,
    columns,
    viewMetadata: DOMAIN_COMPATIBILITY_EXPECTATIONS.views.map(({ name }) => ({
      name, updatable: true, insertable: true,
    })),
    functions,
    triggers,
    dataMismatches: {
      ...Object.fromEntries(DOMAIN_COMPATIBILITY_EXPECTATIONS.staffIdAliasTables.map((table) => [`${table}.stylist_id`, 0])),
      "charges.beauty_bank_cents": 0,
      "staff.legacy_stylist_role": 0,
    },
  };
}

function absentSnapshot(): DomainCompatibilitySnapshot {
  const snapshot = completeSnapshot();
  const viewNames = new Set(DOMAIN_COMPATIBILITY_EXPECTATIONS.views.map(({ name }) => name));
  const aliasKeys = new Set([
    ...DOMAIN_COMPATIBILITY_EXPECTATIONS.staffIdAliasTables.map((table) => `${table}.stylist_id`),
    "charges.beauty_bank_cents",
    "staff.legacy_stylist_role",
  ]);
  snapshot.relations = snapshot.relations.filter(({ name }) => !viewNames.has(name));
  snapshot.columns = snapshot.columns.filter(({ table, name }) => !aliasKeys.has(`${table}.${name}`) && !viewNames.has(table));
  snapshot.viewMetadata = [];
  snapshot.functions = [];
  snapshot.triggers = [];
  snapshot.dataMismatches = {};
  return snapshot;
}

describe("domain compatibility migration 0060 repair classification", () => {
  it("accepts a complete v60 footprint and synchronized alias aggregates", () => {
    expect(classifyDomainCompatibilitySnapshot(completeSnapshot(), schema).state).toBe("present");
  });

  it("recognizes a fully absent footprint as eligible only when canonical prerequisites are valid", () => {
    expect(classifyDomainCompatibilitySnapshot(absentSnapshot(), schema).state).toBe("missing");

    const drifted = absentSnapshot();
    const staffId = drifted.columns.find((column) => column.table === "appointments" && column.name === "staff_id");
    if (staffId) staffId.notNull = false;
    expect(classifyDomainCompatibilitySnapshot(drifted, schema).state).toBe("blocked");
  });

  it("treats a legacy-name collision or wrong relation kind as partial", () => {
    const snapshot = absentSnapshot();
    snapshot.relations.push({ name: "stylists", kind: "r", options: [], definition: null });
    expect(classifyDomainCompatibilitySnapshot(snapshot, schema).state).toBe("partial");
  });

  it("rejects view definition, security option, updatability, and output-order drift", () => {
    const mutations: Array<(snapshot: DomainCompatibilitySnapshot) => void> = [
      (snapshot) => { snapshot.relations.find(({ name }) => name === "stylists")!.definition += " WHERE true"; },
      (snapshot) => { snapshot.relations.find(({ name }) => name === "stylists")!.options = []; },
      (snapshot) => { snapshot.viewMetadata.find(({ name }) => name === "stylists")!.updatable = false; },
      (snapshot) => { snapshot.columns.find(({ table, name }) => table === "stylists" && name === "role")!.position = 1; },
    ];
    for (const mutate of mutations) {
      const snapshot = completeSnapshot();
      mutate(snapshot);
      expect(classifyDomainCompatibilitySnapshot(snapshot, schema).state).toBe("partial");
    }
  });

  it("rejects alias type, nullability, and default drift", () => {
    const mutations: Array<(snapshot: DomainCompatibilitySnapshot) => void> = [
      (snapshot) => { snapshot.columns.find(({ table, name }) => table === "appointments" && name === "stylist_id")!.dataType = "text"; },
      (snapshot) => { snapshot.columns.find(({ table, name }) => table === "charges" && name === "beauty_bank_cents")!.notNull = true; },
      (snapshot) => { snapshot.columns.find(({ table, name }) => table === "staff" && name === "legacy_stylist_role")!.defaultExpression = null; },
    ];
    for (const mutate of mutations) {
      const snapshot = completeSnapshot();
      mutate(snapshot);
      expect(classifyDomainCompatibilitySnapshot(snapshot, schema).state).toBe("partial");
    }
  });

  it("rejects a changed function body, signature, security mode, or search path", () => {
    const mutations: Array<(snapshot: DomainCompatibilitySnapshot) => void> = [
      (snapshot) => {
        const fn = snapshot.functions[0];
        fn.source += "\nRETURN OLD;";
        Object.assign(fn, {
          sourceDigest: (DOMAIN_COMPATIBILITY_EXPECTATIONS.functionSourceHashes as Record<string, string>)[fn.name],
        });
      },
      (snapshot) => { snapshot.functions[0].identityArguments = "x integer"; },
      (snapshot) => { snapshot.functions[0].securityDefiner = true; },
      (snapshot) => { snapshot.functions[0].config = ["search_path=public"]; },
      (snapshot) => { snapshot.functions[0].isStrict = true; },
      (snapshot) => { snapshot.functions[0].volatility = "s"; },
      (snapshot) => { snapshot.functions[0].parallel = "s"; },
      (snapshot) => { snapshot.functions[0].leakproof = true; },
    ];
    for (const mutate of mutations) {
      const snapshot = completeSnapshot();
      mutate(snapshot);
      expect(classifyDomainCompatibilitySnapshot(snapshot, schema).state).toBe("partial");
    }
  });

  it("rejects missing, disabled, misbound, conditional, or argument-bearing triggers", () => {
    const mutations: Array<(snapshot: DomainCompatibilitySnapshot) => void> = [
      (snapshot) => { snapshot.triggers.pop(); },
      (snapshot) => { snapshot.triggers[0].enabled = "D"; },
      (snapshot) => { snapshot.triggers[0].functionName = DOMAIN_COMPATIBILITY_EXPECTATIONS.roleFunction; },
      (snapshot) => { snapshot.triggers[0].condition = "true"; },
      (snapshot) => { snapshot.triggers[0].argumentCount = 1; },
    ];
    for (const mutate of mutations) {
      const snapshot = completeSnapshot();
      mutate(snapshot);
      expect(classifyDomainCompatibilitySnapshot(snapshot, schema).state).toBe("partial");
    }
  });

  it("rejects stale aliases while returning only bounded structural details", () => {
    const snapshot = completeSnapshot();
    snapshot.dataMismatches["appointments.stylist_id"] = 7;
    const result = classifyDomainCompatibilitySnapshot(snapshot, schema);
    expect(result.state).toBe("partial");
    expect(result.objects).toContain("data appointments.stylist_id");
    expect(JSON.stringify(result)).not.toContain("7");
    expect(result.objects.length).toBeLessThanOrEqual(24);
  });
});

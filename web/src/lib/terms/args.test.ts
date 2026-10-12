import { describe, expect, it } from "vitest";
import { VERTICALS, VERTICAL_IDS, type VerticalTerms } from "@/lib/verticals";
import { mergeTermValues, termArgs } from "./args";

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

describe("termArgs", () => {
  it.each(VERTICAL_IDS)("builds all variants for the %s pack", (id) => {
    const terms = VERTICALS[id].terms;
    const args = termArgs(terms);
    for (const key of ["staff", "customer", "booking", "offering", "place"] as const) {
      const one = terms[key].one.toLocaleLowerCase();
      const other = terms[key].other.toLocaleLowerCase();
      const K = upperFirst(key);
      expect(args[key]).toBe(one);
      expect(args[`${key}Plural`]).toBe(other);
      expect(args[K]).toBe(upperFirst(one));
      expect(args[`${K}Plural`]).toBe(upperFirst(other));
    }
    expect(args.prepaidBalance).toBe(terms.prepaidBalance);
    // 5 terms x 4 variants + prepaidBalance
    expect(Object.keys(args)).toHaveLength(21);
  });

  it("returns barber words", () => {
    const args = termArgs(VERTICALS.barber.terms);
    expect(args.StaffPlural).toBe("Barbers");
    expect(args.staff).toBe("barber");
    expect(args.CustomerPlural).toBe("Clients");
  });

  it("lowercases multi-word terms whole and capitalizes only the first character", () => {
    const terms: VerticalTerms = {
      ...VERTICALS.general.terms,
      staff: { one: "Nail Tech", other: "Nail Techs" },
      offering: { one: "Session Type", other: "Session Types" },
      place: { one: "SERVICE AREA", other: "Service Areas" },
    };
    const args = termArgs(terms);
    expect(args.staff).toBe("nail tech");
    expect(args.Staff).toBe("Nail tech");
    expect(args.StaffPlural).toBe("Nail techs");
    expect(args.Offering).toBe("Session type");
    expect(args.offeringPlural).toBe("session types");
    expect(args.Place).toBe("Service area");
    expect(args.PlacePlural).toBe("Service areas");
  });
});

describe("mergeTermValues", () => {
  const terms = VERTICALS.barber.terms;

  it("includes term args", () => {
    expect(mergeTermValues(terms).StaffPlural).toBe("Barbers");
    expect(mergeTermValues(terms, { count: 2 }).count).toBe(2);
  });

  it("lets explicit values override term args", () => {
    const merged = mergeTermValues(terms, { StaffPlural: "Team", n: 1 });
    expect(merged.StaffPlural).toBe("Team");
    expect(merged.CustomerPlural).toBe("Clients");
    expect(merged.n).toBe(1);
  });
});

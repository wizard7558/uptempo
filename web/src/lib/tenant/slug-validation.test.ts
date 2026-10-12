import { describe, it, expect } from "vitest";
import { validateSlug, slugSchema } from "./slug-validation";

describe("slug-validation", () => {
  describe("validateSlug", () => {
    it("accepts valid slugs", () => {
      expect(validateSlug("acme-salon")).toEqual({ valid: true });
      expect(validateSlug("janes-hair")).toEqual({ valid: true });
      expect(validateSlug("salon123")).toEqual({ valid: true });
      expect(validateSlug("abc")).toEqual({ valid: true });
    });

    it("rejects slugs shorter than 3 characters", () => {
      const result = validateSlug("ab");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("at least 3");
    });

    it("rejects slugs longer than 50 characters", () => {
      const result = validateSlug("a".repeat(51));
      expect(result.valid).toBe(false);
      expect(result.error).toContain("at most 50");
    });

    it("rejects slugs starting with a number", () => {
      const result = validateSlug("123salon");
      expect(result.valid).toBe(false);
    });

    it("rejects slugs with uppercase letters", () => {
      const result = validateSlug("AcmeSalon");
      expect(result.valid).toBe(false);
    });

    it("rejects slugs ending with a hyphen", () => {
      const result = validateSlug("acme-");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("hyphen");
    });

    it("rejects slugs with consecutive hyphens", () => {
      const result = validateSlug("acme--salon");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("consecutive");
    });

    it("rejects reserved slugs", () => {
      expect(validateSlug("admin").valid).toBe(false);
      expect(validateSlug("admin").error).toContain("reserved");
      expect(validateSlug("api").valid).toBe(false);
      expect(validateSlug("emme").valid).toBe(false);
      expect(validateSlug("dashboard").valid).toBe(false);
      expect(validateSlug("staging").valid).toBe(false);
      expect(validateSlug("uptempo").valid).toBe(false);
      expect(validateSlug("bookuptempo").valid).toBe(false);
      expect(validateSlug("rende").valid).toBe(false);
      expect(validateSlug("byrende").valid).toBe(false);
    });

    it("rejects slugs with special characters", () => {
      expect(validateSlug("acme_salon").valid).toBe(false);
      expect(validateSlug("acme.salon").valid).toBe(false);
      expect(validateSlug("acme salon").valid).toBe(false);
    });
  });

  describe("slugSchema", () => {
    it("parses valid slugs", () => {
      expect(slugSchema.parse("valid-slug")).toBe("valid-slug");
    });

    it("throws on invalid slugs", () => {
      expect(() => slugSchema.parse("admin")).toThrow();
      expect(() => slugSchema.parse("AB")).toThrow();
    });
  });
});

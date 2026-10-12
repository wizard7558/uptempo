import { describe, it, expect } from "vitest";
import { pgErrorInfo } from "./pg-error";

describe("pgErrorInfo", () => {
  it("reads code and constraint_name from a plain driver error", () => {
    const err = Object.assign(new Error("x"), {
      code: "23P01",
      constraint_name: "appointments_no_overlap",
    });
    expect(pgErrorInfo(err)).toEqual({
      code: "23P01",
      constraint: "appointments_no_overlap",
    });
  });

  it("walks a DrizzleQueryError-style wrapper to its cause", () => {
    const driver = Object.assign(new Error("exclusion"), {
      code: "23P01",
      constraint_name: "appointments_no_overlap",
    });
    const wrapped = Object.assign(new Error("Failed query: insert ..."), {
      cause: driver,
    });
    expect(pgErrorInfo(wrapped)).toEqual({
      code: "23P01",
      constraint: "appointments_no_overlap",
    });
  });

  it("falls back to `constraint` when constraint_name is absent", () => {
    expect(pgErrorInfo({ code: "23505", constraint: "u" })).toEqual({
      code: "23505",
      constraint: "u",
    });
  });

  it("returns an empty object when there is no code", () => {
    expect(pgErrorInfo(new Error("boom"))).toEqual({});
    expect(pgErrorInfo(null)).toEqual({});
    expect(pgErrorInfo("str")).toEqual({});
  });

  it("does not loop on circular causes", () => {
    const a: { cause?: unknown } = {};
    const b: { cause?: unknown } = { cause: a };
    a.cause = b;
    expect(pgErrorInfo(a)).toEqual({});
  });
});

import { describe, expect, it } from "vitest";
import { toPlainSms } from "./plain-text";

describe("toPlainSms", () => {
  it("turns smart punctuation into plain punctuation", () => {
    expect(toPlainSms("Sam’s “van” – on the way…")).toBe(
      "Sam's \"van\" - on the way...",
    );
  });

  it("drops emoji and removes accents", () => {
    expect(toPlainSms("Café Cléa 🚐 is here")).toBe("Cafe Clea is here");
  });

  it("collapses whitespace and leaves plain text alone", () => {
    expect(toPlainSms("  Sam  from Bright Co. ")).toBe("Sam from Bright Co.");
    expect(toPlainSms("Arriving in about 15 minutes.")).toBe(
      "Arriving in about 15 minutes.",
    );
  });
});

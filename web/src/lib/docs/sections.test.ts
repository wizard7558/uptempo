import { describe, expect, it } from "vitest";
import { DOC_SECTIONS, getDocSection } from "./sections";

describe("docs sections", () => {
  it("publishes the four reader sections", () => {
    expect(DOC_SECTIONS.map((section) => section.slug)).toEqual([
      "self-hosting",
      "modules",
      "api",
      "contributing",
    ]);
  });

  it("names the docker quickstart, classes, the queue, an endpoint, and the DCO", () => {
    expect(getDocSection("self-hosting")?.paragraphs.join(" ")).toContain("docker compose up -d");
    expect(getDocSection("modules")?.heading).toContain("walk-in queue");
    expect(getDocSection("modules")?.paragraphs.join(" ")).toContain("Classes");
    expect(getDocSection("api")?.heading).toBe("GET /api/health");
    expect(getDocSection("contributing")?.paragraphs.join(" ")).toContain(
      "Developer Certificate of Origin",
    );
  });

  it("does not include a live key or a database URL", () => {
    const text = JSON.stringify(DOC_SECTIONS);
    expect(text).not.toMatch(/sk_live|postgres:\/\//);
  });
});

import { describe, expect, it } from "vitest";
import * as smsTemplates from "./template";
import {
  DEFAULT_SMS_CONFIRMATION_TEMPLATE,
  DEFAULT_SMS_QUEUE_CALLED_TEMPLATE,
  DEFAULT_SMS_QUEUE_JOINED_TEMPLATE,
  DEFAULT_SMS_WAITLIST_OFFER_TEMPLATE,
  renderSmsTemplate,
} from "./template";

const values = {
  client: "Ana",
  staff: "Sam",
  date: "Friday, May 1, 2026",
  time: "2:00 PM",
  services: "Fade, Beard",
};

describe("renderSmsTemplate", () => {
  it("substitutes the {staff} placeholder", () => {
    expect(renderSmsTemplate("Hi {client}, see {staff} at {time}.", values)).toBe(
      "Hi Ana, see Sam at 2:00 PM.",
    );
  });

  it("still substitutes the legacy {stylist} placeholder", () => {
    expect(
      renderSmsTemplate("Hi {client}, see {stylist} on {date}: {services}.", values),
    ).toBe("Hi Ana, see Sam on Friday, May 1, 2026: Fade, Beard.");
  });

  it("substitutes both placeholders and repeated occurrences in one template", () => {
    expect(renderSmsTemplate("{stylist}/{staff}/{staff}", values)).toBe(
      "Sam/Sam/Sam",
    );
  });

  it("default template uses {staff} and renders fully", () => {
    expect(DEFAULT_SMS_CONFIRMATION_TEMPLATE).toContain("{staff}");
    expect(DEFAULT_SMS_CONFIRMATION_TEMPLATE).not.toContain("{stylist}");
    expect(renderSmsTemplate(DEFAULT_SMS_CONFIRMATION_TEMPLATE, values)).not.toMatch(
      /[{}]/,
    );
  });

  it("substitutes {business}, {link} and {minutes} when defined", () => {
    expect(
      renderSmsTemplate("{business}: {link} ({minutes} min)", {
        ...values,
        business: "Emme",
        link: "https://x.test/q/abc",
        minutes: "15",
      }),
    ).toBe("Emme: https://x.test/q/abc (15 min)");
  });

  it("leaves the literal when an optional value is undefined", () => {
    expect(renderSmsTemplate("{business} {link} {minutes}", values)).toBe(
      "{business} {link} {minutes}",
    );
  });

  it("renders every default template as plain characters", () => {
    const samples = {
      client: "Ana",
      staff: "Sam",
      date: "Friday, May 1, 2026",
      time: "2:00 PM",
      services: "Fade, Beard",
      business: "North Co",
      link: "https://example.com/book",
      minutes: "15",
    };
    const renderedNames: string[] = [];
    for (const [name, template] of Object.entries(smsTemplates)) {
      if (!name.startsWith("DEFAULT_SMS_") || typeof template !== "string") continue;
      renderedNames.push(name);
      const rendered = renderSmsTemplate(template, samples);
      expect(rendered).toMatch(/^[\x20-\x7E\n]*$/);
      expect(rendered).not.toMatch(/[{}]/);
    }
    expect(renderedNames).toEqual(
      expect.arrayContaining([
        "DEFAULT_SMS_CONFIRMATION_TEMPLATE",
        "DEFAULT_SMS_QUEUE_JOINED_TEMPLATE",
        "DEFAULT_SMS_QUEUE_CALLED_TEMPLATE",
        "DEFAULT_SMS_WAITLIST_OFFER_TEMPLATE",
      ]),
    );
  });

  it("default queue and waitlist templates are plain ASCII", () => {
    for (const t of [
      DEFAULT_SMS_QUEUE_JOINED_TEMPLATE,
      DEFAULT_SMS_QUEUE_CALLED_TEMPLATE,
      DEFAULT_SMS_WAITLIST_OFFER_TEMPLATE,
    ]) {
      expect(/^[\x20-\x7e]+$/.test(t)).toBe(true);
    }
  });
});

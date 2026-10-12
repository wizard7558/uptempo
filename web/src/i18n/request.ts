import { getRequestConfig } from "next-intl/server";

// Single-locale setup (no i18n routing): every request resolves to English.
export default getRequestConfig(async () => {
  const locale = "en";
  return {
    locale,
    messages: (await import("./messages/en.json")).default,
  };
});

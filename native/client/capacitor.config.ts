import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Uptempo (client) iOS app — the consumer marketplace.
 *
 * Remote-URL mode: opens the appointment-business directory; clients choose a
 * business and book at /book/:slug. Stripe payment (PaymentElement/SetupIntent)
 * runs inline in the WebView. The `uptempo-client://` scheme handles approved
 * system-browser return links (registered in Xcode → URL Types).
 */
const config: CapacitorConfig = {
  appId: "com.uptempo.client",
  appName: "Uptempo",
  webDir: "www",
  // Native feel: opaque canvas everywhere in the app's ivory (--background,
  // hsl(38 36% 96%)), no pinch/double-tap zoom.
  backgroundColor: "#F8F6F1",
  zoomEnabled: false,
  server: {
    url: "https://www.bookuptempo.com/discover",
    allowNavigation: ["bookuptempo.com", "*.bookuptempo.com"],
    iosScheme: "https",
  },
  ios: {
    // "always" shifted rendered content relative to touch targets on sticky
    // elements (taps landed one row off). The status bar is opaque (below)
    // instead, so no inset is needed.
    contentInset: "never",
  },
  plugins: {
    StatusBar: {
      // Keep the webview below an opaque status bar: dark icons on the app's
      // ivory, content never under the notch, no safe-area CSS required.
      // backgroundColor is REQUIRED here — the plugin's backing view defaults
      // to UIColor.black when overlaysWebView is false.
      overlaysWebView: false,
      style: "LIGHT",
      backgroundColor: "#F8F6F1",
    },
    PushNotifications: {
      presentationOptions: ["alert", "badge", "sound"],
    },
  },
};

export default config;

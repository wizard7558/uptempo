import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Uptempo Pro (owner/staff) iOS app.
 *
 * Remote-URL mode: the WebView loads the live site. Navigation is restricted to
 * the Uptempo domain; external auth flows (Google Calendar OAuth, Stripe
 * Connect) are opened in the system browser by the web app and return via the
 * `uptempo-owner://` custom scheme (registered in Xcode → URL Types).
 */
const config: CapacitorConfig = {
  appId: "com.uptempo.owner",
  appName: "Uptempo Pro",
  webDir: "www",
  // Native feel: opaque canvas everywhere in the app's ivory (--background,
  // hsl(38 36% 96%)), no pinch/double-tap zoom.
  backgroundColor: "#F8F6F1",
  zoomEnabled: false,
  server: {
    url: "https://bookuptempo.com/login",
    allowNavigation: ["bookuptempo.com", "*.bookuptempo.com"],
    iosScheme: "https",
  },
  ios: {
    // "always" shifted rendered content relative to touch targets on sticky
    // elements (sidebar taps landed one row off). The status bar is opaque
    // (below) instead, so no inset is needed.
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

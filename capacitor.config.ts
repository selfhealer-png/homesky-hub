import type { CapacitorConfig } from '@capacitor/cli';

// The iOS app: the web app built in app mode (`npm run build:app` → dist-app/), with the Worker
// running inside the page (src/web/app/boot.ts). See docs/IOS-PLAN.md.
const config: CapacitorConfig = {
  // Change before the first App Store Connect record: it can't be changed after.
  appId: 'app.homesky.hub',
  appName: 'Home&Sky Hub',
  webDir: 'dist-app',
  ios: {
    // Swift Package Manager: no CocoaPods, so the project can be generated and synced on Windows.
    // (Capacitor 8's default; kept explicit because `cap add ios` must not fall back to Pods.)
    scheme: 'Home&Sky Hub',
    contentInset: 'never',
    backgroundColor: '#0B0F1A',
    // Debug builds can be inspected from a Windows WebKit inspector (docs/IOS-PLAN.md §10).
    webContentsDebuggingEnabled: process.env.HUB_RELEASE !== '1',
    // Long-running always-on display: never let a link leave the app's own pages.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    // Native HTTP for every fetch: no CORS, and a User-Agent the data sources ask for.
    CapacitorHttp: { enabled: true },
    StatusBar: { overlaysWebView: true, style: 'DARK' },
  },
};

export default config;

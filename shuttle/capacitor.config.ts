import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.shuttle.recorder',
  appName: 'Shuttle',
  webDir: 'dist',
  android: {
    // Video files are large; keep the WebView from blocking mixed content or
    // cleartext needlessly while still serving the app from https://localhost.
    allowMixedContent: false,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'DARK',
    },
  },
};

export default config;

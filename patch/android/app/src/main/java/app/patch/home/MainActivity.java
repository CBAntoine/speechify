package app.patch.home;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Typeface;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * Patch's screen: the same dashboard as on a computer, shown from Patch's server running on this phone.
 * Pages and videos meant for "this phone" are handed to Android (the browser, the YouTube app…).
 */
public class MainActivity extends Activity {
    private static final String HOME = "http://127.0.0.1:" + PatchServer.PORT + "/";
    private static final String TAG = "Patch";
    private static final int ASK_MIC = 1;

    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView web;
    private LinearLayout splash;
    private TextView status;
    private ProgressBar spinner;
    private Button retry;
    private WifiManager.MulticastLock multicast;
    private PermissionRequest waitingForMic;
    private boolean loaded;
    private boolean loadFailed;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        PatchServer.start(this);
        WebView.setWebContentsDebuggingEnabled(getResources().getBoolean(R.bool.patch_debug_webview));
        buildViews();
        forgetOldPagesAfterUpdate();
        waitForPatch();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        holdMulticast(true);
    }

    @Override
    protected void onPause() {
        holdMulticast(false);
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    // ── The screen ──────────────────────────────────────────────────────────

    private void buildViews() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int background = dark ? 0xFF0B0F19 : 0xFFF3F4F8;
        int text = dark ? 0xFFEDF0F8 : 0xFF121726;
        int muted = dark ? 0xFF808AA8 : 0xFF737C94;

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(background);

        web = new WebView(this);
        web.setBackgroundColor(background);
        web.setVisibility(View.INVISIBLE);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        splash = new LinearLayout(this);
        splash.setOrientation(LinearLayout.VERTICAL);
        splash.setGravity(Gravity.CENTER);
        splash.setBackgroundColor(background);
        splash.setPadding(dp(32), dp(32), dp(32), dp(32));

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        splash.addView(logo, new LinearLayout.LayoutParams(dp(96), dp(96)));

        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextColor(text);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        splash.addView(title, spaced(dp(14)));

        status = new TextView(this);
        status.setTextColor(muted);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        status.setGravity(Gravity.CENTER);
        status.setLineSpacing(0, 1.2f);
        splash.addView(status, spaced(dp(6)));

        spinner = new ProgressBar(this);
        splash.addView(spinner, spaced(dp(26)));

        retry = new Button(this);
        retry.setText(R.string.try_again);
        retry.setVisibility(View.GONE);
        retry.setOnClickListener(v -> tryAgain());
        splash.addView(retry, spaced(dp(22)));

        root.addView(splash, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        setUpWebView();
    }

    private LinearLayout.LayoutParams spaced(int top) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = top;
        return p;
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    private void showStarting() {
        splash.setVisibility(View.VISIBLE);
        splash.setAlpha(1f);
        status.setText(R.string.starting);
        spinner.setVisibility(View.VISIBLE);
        retry.setVisibility(View.GONE);
    }

    private void showProblem(String message) {
        splash.animate().cancel();
        splash.setVisibility(View.VISIBLE);
        splash.setAlpha(1f);
        status.setText(message);
        spinner.setVisibility(View.GONE);
        retry.setVisibility(View.VISIBLE);
    }

    private void showDashboard() {
        web.setVisibility(View.VISIBLE);
        splash.animate().alpha(0f).setDuration(220).withEndAction(() -> splash.setVisibility(View.GONE));
    }

    // ── Starting Patch ──────────────────────────────────────────────────────

    /** Waits until Patch's server answers, then shows the dashboard. */
    private void waitForPatch() {
        showStarting();
        Thread waiter = new Thread(() -> {
            long until = System.currentTimeMillis() + 120_000;
            while (System.currentTimeMillis() < until) {
                String failure = PatchServer.failure();
                if (failure != null) {
                    main.post(() -> showProblem(failure));
                    return;
                }
                if (answering()) {
                    main.post(() -> {
                        if (web == null) return;
                        loadFailed = false;
                        web.loadUrl(HOME);
                    });
                    return;
                }
                try {
                    Thread.sleep(250);
                } catch (InterruptedException e) {
                    return;
                }
            }
            main.post(() -> showProblem(getString(R.string.too_slow)));
        }, "patch-wait");
        waiter.setDaemon(true);
        waiter.start();
    }

    private static boolean answering() {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("127.0.0.1", PatchServer.PORT), 400);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void tryAgain() {
        if (PatchServer.failure() == null) {
            waitForPatch();
            return;
        }
        // Node.js can't be started twice in one process: start the app afresh.
        Intent restart = Intent.makeRestartActivityTask(getComponentName());
        startActivity(restart);
        Runtime.getRuntime().exit(0);
    }

    /** After an app update, drop the old copies of the dashboard's pages. */
    private void forgetOldPagesAfterUpdate() {
        try {
            long installed = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
            SharedPreferences prefs = getSharedPreferences("patch", MODE_PRIVATE);
            if (prefs.getLong("pagesFrom", 0) != installed) {
                web.clearCache(true);
                prefs.edit().putLong("pagesFrom", installed).apply();
            }
        } catch (PackageManager.NameNotFoundException ignored) {
            // can't happen for our own package
        }
    }

    // ── The dashboard ───────────────────────────────────────────────────────

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void setUpWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " PatchAndroid");
        // Only Patch's own page is ever shown here (everything else opens outside), so only it can call this.
        web.addJavascriptInterface(new Bridge(), "PatchAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (isPatch(url)) return false;
                openOutside(url);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!loadFailed && isPatch(Uri.parse(url))) {
                    loaded = true;
                    Log.i(TAG, "Dashboard shown");
                    showDashboard();
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                loadFailed = true;
                showProblem(getString(R.string.lost_patch));
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                main.post(() -> answerPermission(request));
            }
        });
    }

    private static boolean isPatch(Uri u) {
        return u != null && "http".equals(u.getScheme()) && ("127.0.0.1".equals(u.getHost()) || "localhost".equals(u.getHost())) && u.getPort() == PatchServer.PORT;
    }

    /** Opens a page outside Patch: the browser, or the app made for it (YouTube links open the YouTube app). */
    private void openOutside(Uri url) {
        String scheme = url.getScheme();
        if (!"http".equals(scheme) && !"https".equals(scheme) && !"mailto".equals(scheme)) return;
        Log.i(TAG, "Opening " + url.getHost() + " outside Patch");
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_LONG).show();
        }
    }

    /** Called from the dashboard: window.PatchAndroid.openUrl("https://…"). */
    private final class Bridge {
        @JavascriptInterface
        public void openUrl(String url) {
            Uri u = Uri.parse(url == null ? "" : url);
            if (!"http".equals(u.getScheme()) && !"https".equals(u.getScheme())) return;
            main.post(() -> openOutside(u));
        }
    }

    // ── Microphone (for talking to Patch) ───────────────────────────────────

    private void answerPermission(PermissionRequest request) {
        boolean audioOnly = request.getResources().length > 0;
        for (String r : request.getResources()) {
            if (!PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audioOnly = false;
        }
        if (!isPatch(request.getOrigin()) || !audioOnly) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            return;
        }
        if (waitingForMic != null) waitingForMic.deny();
        waitingForMic = request;
        requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, ASK_MIC);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != ASK_MIC || waitingForMic == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            waitingForMic.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            waitingForMic.deny();
        }
        waitingForMic = null;
    }

    // ── Hearing devices announce themselves ─────────────────────────────────

    /** Wi-Fi chips drop Bonjour/UPnP announcements to save battery unless an app asks; only while Patch is open. */
    private void holdMulticast(boolean hold) {
        try {
            if (multicast == null) {
                WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wifi == null) return;
                multicast = wifi.createMulticastLock("patch");
                multicast.setReferenceCounted(false);
            }
            if (hold) multicast.acquire();
            else if (multicast.isHeld()) multicast.release();
        } catch (RuntimeException ignored) {
            // not allowed on this phone: discovery by address still works
        }
    }

    // ── Back button ─────────────────────────────────────────────────────────

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (!loaded || web == null) {
            leave();
            return;
        }
        // Close whatever's open in the dashboard first (a device, Settings, the chat sheet).
        web.evaluateJavascript("window.__patchBack ? String(window.__patchBack()) : 'false'", closed -> {
            if (!"\"true\"".equals(closed)) leave();
        });
    }

    @SuppressWarnings("deprecation")
    private void leave() {
        super.onBackPressed();
    }
}

package app.patch.home;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Lets Patch see what's on the phone's screen and use it when asked: read the items, tap one by its
 * number or words, scroll, type into a box, go back or home. Only runs when the person turns it on in
 * Settings → Accessibility. Patch never reads or types into password boxes.
 */
public class PatchAccessibility extends AccessibilityService {
    private static final String TAG = "Patch";
    private static final int MAX_ITEMS = 150;
    private static final int MAX_TEXT = 160;
    private static final int MAX_CHARS = 6000;
    private static volatile PatchAccessibility instance;

    private final Object lock = new Object();
    private final List<Item> lastItems = new ArrayList<>();
    private HandlerThread gestures;
    private Handler gestureHandler;

    /** One thing on the screen, numbered in reading order. */
    static final class Item {
        int n;
        String kind;
        String text;
        String state;
        final Rect bounds = new Rect();
        AccessibilityNodeInfo node;
        boolean clickable;
    }

    static PatchAccessibility get() {
        return instance;
    }

    @Override
    protected void onServiceConnected() {
        gestures = new HandlerThread("patch-gestures");
        gestures.start();
        gestureHandler = new Handler(gestures.getLooper());
        instance = this;
        Log.i(TAG, "Screen access is on");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Patch only looks at the screen when asked; nothing to do here.
    }

    @Override
    public void onInterrupt() {}

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        instance = null;
        Log.i(TAG, "Screen access is off");
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (gestures != null) gestures.quitSafely();
        super.onDestroy();
    }

    /** Runs one bridge command (screen, tap, scroll, type, enter, global). */
    JSONObject command(String command, JSONObject a) throws JSONException {
        synchronized (lock) {
            switch (command) {
                case "screen": return describe(snapshot());
                case "tap": return tap(a.optString("target"), a.optBoolean("check"), a.optString("expect", null));
                case "scroll": return scroll(a.optString("direction", "down"));
                case "type": return type(a.optString("text"), a.optBoolean("submit"));
                case "enter": return enter();
                case "global": return global(a.optString("action"));
                default: return PhoneBridge.fail("EUNKNOWN", "Unknown screen command.");
            }
        }
    }

    // ── Reading the screen ──────────────────────────────────────────────────

    private List<Item> snapshot() {
        lastItems.clear();
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return lastItems;
        walk(root, 0, new int[] {0});
        for (int i = 0; i < lastItems.size(); i++) lastItems.get(i).n = i + 1;
        return lastItems;
    }

    private void walk(AccessibilityNodeInfo node, int depth, int[] chars) {
        if (node == null || depth > 80 || lastItems.size() >= MAX_ITEMS || chars[0] > MAX_CHARS) return;
        if (!node.isVisibleToUser()) return;
        String label = labelOf(node);
        boolean editable = node.isEditable();
        if (!label.isEmpty() || editable) {
            Rect r = new Rect();
            node.getBoundsInScreen(r);
            Item prev = lastItems.isEmpty() ? null : lastItems.get(lastItems.size() - 1);
            boolean repeat = prev != null && prev.text.equals(label) && (Rect.intersects(prev.bounds, r) || prev.bounds.contains(r));
            if (repeat) {
                // The same words again inside the item just added (a button and its label): keep one.
                if (!prev.clickable && clickable(node)) {
                    prev.node = node;
                    prev.clickable = true;
                    prev.kind = kindOf(node);
                }
            } else if (r.width() > 0 && r.height() > 0) {
                Item it = new Item();
                it.node = node;
                it.text = label;
                it.kind = kindOf(node);
                it.state = stateOf(node);
                it.clickable = clickable(node);
                it.bounds.set(r);
                lastItems.add(it);
                chars[0] += label.length();
            }
        }
        for (int i = 0; i < node.getChildCount(); i++) walk(node.getChild(i), depth + 1, chars);
    }

    private static boolean clickable(AccessibilityNodeInfo n) {
        return n.isClickable() || n.isLongClickable() || n.isEditable() || n.isCheckable();
    }

    private static String labelOf(AccessibilityNodeInfo n) {
        if (n.isPassword()) return "(password)";
        CharSequence t = n.getText();
        if (t == null || t.toString().trim().isEmpty()) t = n.getContentDescription();
        if ((t == null || t.toString().trim().isEmpty()) && Build.VERSION.SDK_INT >= 26) t = n.getHintText();
        if (t == null) return "";
        String s = t.toString().replaceAll("\\s+", " ").trim();
        return s.length() > MAX_TEXT ? s.substring(0, MAX_TEXT - 1) + "…" : s;
    }

    private static String kindOf(AccessibilityNodeInfo n) {
        if (n.isPassword()) return "Password box";
        if (n.isEditable()) return "Text box";
        String role = "";
        Bundle extras = n.getExtras();
        if (extras != null) {
            CharSequence r = extras.getCharSequence("AccessibilityNodeInfo.roleDescription");
            if (r != null) role = r.toString().toLowerCase(Locale.ROOT);
        }
        String cls = n.getClassName() == null ? "" : n.getClassName().toString();
        if (role.contains("link")) return "Link";
        if (role.contains("heading") || (Build.VERSION.SDK_INT >= 28 && n.isHeading())) return "Heading";
        if (n.isCheckable()) return cls.contains("Switch") || role.contains("switch") ? "Switch" : "Checkbox";
        if (role.contains("tab") || cls.endsWith("Tab")) return "Tab";
        if (cls.endsWith("Button") || role.contains("button")) return "Button";
        if (cls.endsWith("ImageView") || cls.endsWith("Image")) return n.isClickable() ? "Button" : "Image";
        return n.isClickable() ? "Item" : "Text";
    }

    private static String stateOf(AccessibilityNodeInfo n) {
        if (n.isCheckable()) return n.isChecked() ? "on" : "off";
        if (n.isEditable() && !n.isPassword()) {
            CharSequence t = n.getText();
            CharSequence hint = Build.VERSION.SDK_INT >= 26 ? n.getHintText() : null;
            boolean empty = t == null || t.length() == 0 || (hint != null && hint.toString().contentEquals(t));
            return empty ? "empty" : null;
        }
        if (n.isSelected()) return "selected";
        return null;
    }

    private JSONObject describe(List<Item> items) throws JSONException {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        String pkg = root != null && root.getPackageName() != null ? root.getPackageName().toString() : "";
        JSONArray list = new JSONArray();
        for (Item it : items) {
            JSONObject o = new JSONObject().put("n", it.n).put("kind", it.kind).put("text", it.text).put("tappable", it.clickable);
            if (it.state != null) o.put("state", it.state);
            list.put(o);
        }
        boolean more = root != null && canScroll(root);
        return PhoneBridge.ok().put("app", appName(pkg)).put("package", pkg).put("items", list).put("more", more)
            .put("full", items.size() >= MAX_ITEMS);
    }

    private String appName(String pkg) {
        if (pkg.isEmpty()) return "";
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return String.valueOf(pm.getApplicationLabel(ai));
        } catch (PackageManager.NameNotFoundException e) {
            return pkg;
        }
    }

    private static boolean canScroll(AccessibilityNodeInfo node) {
        if (node == null) return false;
        if (node.isScrollable() && node.isVisibleToUser()) return true;
        for (int i = 0; i < node.getChildCount(); i++) if (canScroll(node.getChild(i))) return true;
        return false;
    }

    // ── Tapping ─────────────────────────────────────────────────────────────

    /** Finds an item by its number (from the last look at the screen) or by its words. */
    private Item find(String target) {
        String t = target == null ? "" : target.trim();
        if (t.matches("\\d{1,3}")) {
            int n = Integer.parseInt(t);
            if (lastItems.isEmpty()) snapshot();
            return n >= 1 && n <= lastItems.size() ? lastItems.get(n - 1) : null;
        }
        List<Item> items = snapshot();
        String want = PhoneBridge.norm(t);
        if (want.isEmpty()) return null;
        Item best = null;
        int bestScore = 0;
        for (Item it : items) {
            String have = PhoneBridge.norm(it.text);
            int score = have.equals(want) ? 100 : have.startsWith(want) ? 80 : have.contains(want) ? 60 : want.contains(have) && have.length() > 3 ? 40 : 0;
            if (score > 0 && it.clickable) score += 5;
            if (score > bestScore) {
                best = it;
                bestScore = score;
            }
        }
        return best;
    }

    private JSONObject tap(String target, boolean checkOnly, String expect) throws JSONException {
        Item it = find(target);
        if (it == null) return PhoneBridge.fail("ENOTFOUND", "I can't find “" + target + "” on the screen.");
        if (expect != null && !PhoneBridge.norm(it.text).equals(PhoneBridge.norm(expect))) {
            Item again = find(expect);
            if (again == null) return PhoneBridge.fail("ECHANGED", "The screen changed. Have another look first.");
            it = again;
        }
        JSONObject found = PhoneBridge.ok().put("n", it.n).put("text", it.text).put("kind", it.kind);
        if (checkOnly) return found;
        boolean done = false;
        if (it.node != null && it.node.refresh()) {
            AccessibilityNodeInfo n = it.node;
            while (n != null && !n.isClickable()) n = n.getParent();
            if (n != null) done = n.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        }
        if (!done) done = tapAt(it.bounds.exactCenterX(), it.bounds.exactCenterY());
        if (!done) return PhoneBridge.fail("EFAILED", "I couldn't tap “" + it.text + "”.");
        Log.i(TAG, "Tapped item " + it.n);
        lastItems.clear(); // the screen is about to change: numbers from before no longer apply
        return found;
    }

    private boolean tapAt(float x, float y) {
        Path p = new Path();
        p.moveTo(x, y);
        return gesture(new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(p, 0, 60)).build());
    }

    private boolean gesture(GestureDescription g) {
        CountDownLatch done = new CountDownLatch(1);
        AtomicBoolean ok = new AtomicBoolean(false);
        boolean sent = dispatchGesture(g, new GestureResultCallback() {
            @Override
            public void onCompleted(GestureDescription gestureDescription) {
                ok.set(true);
                done.countDown();
            }

            @Override
            public void onCancelled(GestureDescription gestureDescription) {
                done.countDown();
            }
        }, gestureHandler);
        if (!sent) return false;
        try {
            done.await(3, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return ok.get();
    }

    // ── Scrolling ───────────────────────────────────────────────────────────

    private JSONObject scroll(String direction) throws JSONException {
        String d = direction == null ? "down" : direction.toLowerCase(Locale.ROOT);
        boolean forward = !(d.contains("up") || d.contains("left") || d.contains("back") || d.contains("top"));
        AccessibilityNodeInfo root = getRootInActiveWindow();
        AccessibilityNodeInfo target = biggestScrollable(root);
        boolean done = false;
        if (target != null) {
            if (Build.VERSION.SDK_INT >= 23) {
                AccessibilityAction directed = d.contains("left") ? AccessibilityAction.ACTION_SCROLL_LEFT : d.contains("right") ? AccessibilityAction.ACTION_SCROLL_RIGHT : forward ? AccessibilityAction.ACTION_SCROLL_DOWN : AccessibilityAction.ACTION_SCROLL_UP;
                if (target.getActionList().contains(directed)) done = target.performAction(directed.getId());
            }
            if (!done) done = target.performAction(forward ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD);
        }
        if (!done) {
            DisplayMetrics m = getResources().getDisplayMetrics();
            float x = m.widthPixels / 2f;
            Path p = new Path();
            p.moveTo(x, m.heightPixels * (forward ? 0.72f : 0.3f));
            p.lineTo(x, m.heightPixels * (forward ? 0.3f : 0.72f));
            done = gesture(new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(p, 0, 320)).build());
        }
        lastItems.clear();
        return done ? PhoneBridge.ok() : PhoneBridge.fail("EFAILED", "That screen doesn't scroll.");
    }

    private static AccessibilityNodeInfo biggestScrollable(AccessibilityNodeInfo node) {
        if (node == null || !node.isVisibleToUser()) return null;
        AccessibilityNodeInfo best = node.isScrollable() ? node : null;
        long bestArea = best != null ? area(best) : 0;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo c = biggestScrollable(node.getChild(i));
            if (c != null && area(c) > bestArea) {
                best = c;
                bestArea = area(c);
            }
        }
        return best;
    }

    private static long area(AccessibilityNodeInfo n) {
        Rect r = new Rect();
        n.getBoundsInScreen(r);
        return (long) r.width() * r.height();
    }

    // ── Typing ──────────────────────────────────────────────────────────────

    private JSONObject type(String text, boolean submit) throws JSONException {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return PhoneBridge.fail("ENOSCREEN", "I can't see the screen right now.");
        AccessibilityNodeInfo box = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (box == null || !box.isEditable()) box = firstEditable(root);
        if (box == null) return PhoneBridge.fail("ENOTFOUND", "There's no text box on the screen. Tap one first.");
        if (box.isPassword()) return PhoneBridge.fail("EPASSWORD", "I don't type passwords. Please type it yourself.");
        if (!box.isFocused()) box.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        if (!box.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return PhoneBridge.fail("EFAILED", "That box didn't take the text.");
        JSONObject r = PhoneBridge.ok();
        if (submit) r.put("submitted", pressEnter(box));
        lastItems.clear();
        return r;
    }

    private JSONObject enter() throws JSONException {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        AccessibilityNodeInfo box = root == null ? null : root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (box == null) return PhoneBridge.fail("ENOTFOUND", "There's no text box selected.");
        lastItems.clear();
        return pressEnter(box) ? PhoneBridge.ok() : PhoneBridge.fail("EFAILED", "Enter didn't do anything here. Tap the search or send button instead.");
    }

    private static boolean pressEnter(AccessibilityNodeInfo box) {
        if (Build.VERSION.SDK_INT >= 30) return box.performAction(AccessibilityAction.ACTION_IME_ENTER.getId());
        return false;
    }

    private static AccessibilityNodeInfo firstEditable(AccessibilityNodeInfo node) {
        if (node == null || !node.isVisibleToUser()) return null;
        if (node.isEditable()) return node;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo e = firstEditable(node.getChild(i));
            if (e != null) return e;
        }
        return null;
    }

    // ── Back, home… ─────────────────────────────────────────────────────────

    private JSONObject global(String action) throws JSONException {
        int code;
        switch (action == null ? "" : action) {
            case "back": code = GLOBAL_ACTION_BACK; break;
            case "home": code = GLOBAL_ACTION_HOME; break;
            case "recents": code = GLOBAL_ACTION_RECENTS; break;
            case "notifications": code = GLOBAL_ACTION_NOTIFICATIONS; break;
            case "quick_settings": code = GLOBAL_ACTION_QUICK_SETTINGS; break;
            default: return PhoneBridge.fail("EVALUE", "Back, home, recent apps or notifications.");
        }
        lastItems.clear();
        return performGlobalAction(code) ? PhoneBridge.ok() : PhoneBridge.fail("EFAILED", "Android didn't do that.");
    }
}

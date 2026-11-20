package app.shuttle.recorder;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.widget.FrameLayout;

import androidx.camera.core.CameraSelector;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.LifecycleOwner;

import com.google.common.util.concurrent.ListenableFuture;

/**
 * A round front-camera preview floating over every app. Because it is on the
 * screen, the screen recording captures it, like the camera bubble in desktop
 * recordings. Drag it anywhere; it stays inside the screen.
 */
final class CameraBubble {
    private final Context ctx;
    private final LifecycleOwner owner;
    private final WindowManager wm;
    private FrameLayout frame;
    private ProcessCameraProvider provider;

    CameraBubble(Context ctx, LifecycleOwner owner) {
        this.ctx = ctx;
        this.owner = owner;
        this.wm = ctx.getSystemService(WindowManager.class);
    }

    private int dp(float v) {
        return Math.round(v * ctx.getResources().getDisplayMetrics().density);
    }

    @SuppressLint("ClickableViewAccessibility")
    void show() {
        final int size = dp(124);
        frame = new FrameLayout(ctx);
        frame.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
                outline.setOval(0, 0, view.getWidth(), view.getHeight());
            }
        });
        frame.setClipToOutline(true);
        frame.setBackgroundColor(Color.BLACK);

        PreviewView preview = new PreviewView(ctx);
        // TextureView-backed, so the round clip applies to the camera image.
        preview.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        preview.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        frame.addView(preview, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        GradientDrawable ring = new GradientDrawable();
        ring.setShape(GradientDrawable.OVAL);
        ring.setColor(Color.TRANSPARENT);
        ring.setStroke(dp(3), Color.WHITE);
        frame.setForeground(ring);

        DisplayMetrics m = ctx.getResources().getDisplayMetrics();
        final WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                size, size,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = m.widthPixels - size - dp(16);
        lp.y = m.heightPixels - size - dp(140);

        frame.setOnTouchListener(new View.OnTouchListener() {
            private float downX;
            private float downY;
            private int startX;
            private int startY;

            @Override
            public boolean onTouch(View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = e.getRawX();
                        downY = e.getRawY();
                        startX = lp.x;
                        startY = lp.y;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        DisplayMetrics dm = ctx.getResources().getDisplayMetrics();
                        lp.x = clamp(startX + Math.round(e.getRawX() - downX), 0, dm.widthPixels - size);
                        lp.y = clamp(startY + Math.round(e.getRawY() - downY), 0, dm.heightPixels - size);
                        wm.updateViewLayout(frame, lp);
                        return true;
                    default:
                        return true;
                }
            }
        });

        wm.addView(frame, lp);

        final ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(ctx);
        future.addListener(() -> {
            try {
                provider = future.get();
                if (frame == null) return;
                Preview p = new Preview.Builder().build();
                p.setSurfaceProvider(preview.getSurfaceProvider());
                provider.unbindAll();
                CameraSelector selector = provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)
                        ? CameraSelector.DEFAULT_FRONT_CAMERA
                        : CameraSelector.DEFAULT_BACK_CAMERA;
                provider.bindToLifecycle(owner, selector, p);
            } catch (Exception e) {
                hide();
            }
        }, ContextCompat.getMainExecutor(ctx));
    }

    void hide() {
        if (provider != null) {
            provider.unbindAll();
            provider = null;
        }
        if (frame != null) {
            try {
                wm.removeView(frame);
            } catch (IllegalArgumentException ignored) {
                // already detached
            }
            frame = null;
        }
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }
}

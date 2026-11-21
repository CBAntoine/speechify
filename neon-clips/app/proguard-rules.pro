# yt-dlp wrapper: it finds its bundled Python, QuickJS and ffmpeg by name and parses update
# metadata with Jackson. Keep both whole; they are small next to the binaries they drive.
-keep class com.yausername.** { *; }
-keep class com.fasterxml.jackson.** { *; }
# Unpacking Python goes through commons-compress, which builds its zip "extra field" handlers
# by reflection. Shrunk, that throws the first time the downloader starts.
-keep class org.apache.commons.compress.** { *; }
-keep class org.apache.commons.io.** { *; }
-dontwarn com.fasterxml.jackson.**
-dontwarn org.apache.commons.**
-dontwarn java.beans.**
-dontwarn org.w3c.dom.bootstrap.**

# Stack traces in bug reports stay readable.
-keepattributes SourceFile,LineNumberTable

# ML Kit finds its detectors by class name at runtime (and from native code). Shrinking them
# away leaves FaceDetection.getClient() with nothing to return, so keep the lot.
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_face.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_face_bundled.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_common.** { *; }
-keep class com.google.android.gms.internal.mlkit_common.** { *; }
-keep class com.google.firebase.components.** { *; }
-keep class com.google.android.libraries.vision.** { *; }
-keep class com.google.android.odml.** { *; }
-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }

# Image loading finds its network and decoder parts through ServiceLoader.
-keep class coil3.network.** { *; }
-keep class * implements coil3.util.FetcherServiceLoaderTarget { *; }
-keep class * implements coil3.util.DecoderServiceLoaderTarget { *; }

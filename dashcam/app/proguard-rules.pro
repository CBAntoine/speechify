# Navigation 3 saves and restores the back stack by serializing the route keys.
-keep class com.cbantoine.dashcam.ui.*Route { *; }
-keep class com.cbantoine.dashcam.ui.*Route$* { *; }

# Telemetry sidecars are kotlinx.serialization models; keep their generated serializers.
-keepclassmembers class com.cbantoine.dashcam.telemetry.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}

# LiteRT's native code calls back into these classes, so keep them whole (they are small).
-keep class org.tensorflow.lite.** { *; }

# ML Kit finds its components through Firebase's ComponentDiscovery, which calls each registrar's
# no-argument constructor by reflection. firebase-components' own rule keeps the classes but,
# under R8 full mode, not their constructors, so ML Kit's init provider crashed the app at
# every start (InvalidRegistrarException).
-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }

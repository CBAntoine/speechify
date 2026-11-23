# Navigation 3 saves and restores the back stack by serializing the route keys.
-keep class com.cbantoine.dashcam.ui.*Route { *; }
-keep class com.cbantoine.dashcam.ui.*Route$* { *; }

# Telemetry sidecars are kotlinx.serialization models; keep their generated serializers.
-keepclassmembers class com.cbantoine.dashcam.telemetry.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}

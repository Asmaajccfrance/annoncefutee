# Conserve tous les ComponentRegistrar chargés par réflexion par Google ML Kit
-keep class * implements com.google.firebase.components.ComponentRegistrar {
    <init>();
    public *;
}

-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_subject_segmentation.** { *; }

# Stockage sécurisé (Tink / Android Keystore)
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**

# Keep Kotlinx Serialization generated serializers
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.papernotes.android.**$$serializer { *; }
-keepclassmembers class com.papernotes.android.** {
    *** Companion;
}
-keepclasseswithmembers class com.papernotes.android.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Keep WebView JS interface methods
-keepclassmembers class com.papernotes.android.ui.editor.EditorJsBridge {
    @android.webkit.JavascriptInterface <methods>;
}

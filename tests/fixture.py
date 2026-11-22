"""A tiny fake of an apktool-decoded YouTube TV: just the constructs our patches look for,
copied in shape from the real 7.30.301 smali/manifest."""
from __future__ import annotations

from pathlib import Path

CFG = {
    "original_package": "com.google.android.youtube.tv",
    "original_version": "7.30.301",
    "package": "app.votv.youtube",
    "label": "YouTube VOTV",
    "version_name": "7.30.301-votv.test",
    "microg_package": "app.revanced.android.gms",
}

MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" android:compileSdkVersion="37" package="com.google.android.youtube.tv">
    <uses-permission android:name="com.google.android.providers.gsf.permission.READ_GSERVICES"/>
    <uses-permission android:name="com.google.android.gms.permission.AD_ID"/>
    <uses-permission android:name="com.google.android.youtube.tv.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"/>
    <queries>
        <package android:name="com.android.vending"/>
    </queries>
    <permission android:name="com.google.android.youtube.tv.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" android:protectionLevel="signature"/>
    <application android:banner="@drawable/app_banner" android:icon="@mipmap/ic_launcher" android:label="@string/app_name" android:name="com.google.android.apps.youtube.tv.application.TvRoot_Application">
        <activity android:name="com.google.android.apps.youtube.tv.activity.ShellActivity" android:taskAffinity="com.google.android.youtube.tv.main">
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LEANBACK_LAUNCHER"/>
            </intent-filter>
            <intent-filter>
                <action android:name="com.google.android.gms.cast.tv.action.LAUNCH"/>
            </intent-filter>
        </activity>
        <service android:name="com.google.android.libraries.youtube.tv.recommendations.RecommendationService" android:process="com.google.android.youtube.tv.recommendations"/>
    </application>
</manifest>
"""

APKTOOL_YML = """version: 2.12.1
apkFileName: YouTube.apk
versionInfo:
  versionCode: 730301320
  versionName: 7.30.301
"""

SHELL = """.class public final Ldev/cobalt/shell/Shell;
.super Landroid/widget/LinearLayout;

.method private setWebContents(Lcobalt/org/chromium/content_public/browser/WebContents;)V
    .locals 12

    new-instance p1, Ldev/cobalt/shell/StartupGuardNavigationObserver;

    iget-object v0, p0, Ldev/cobalt/shell/Shell;->mWebContents:Lcobalt/org/chromium/content_public/browser/WebContents;

    invoke-direct {p1, v0}, Ldev/cobalt/shell/StartupGuardNavigationObserver;-><init>(Lcobalt/org/chromium/content_public/browser/WebContents;)V

    .line 64
    iget-wide v3, v5, Lcobalt/org/chromium/content/browser/JavascriptInjectorImpl;->b:J

    const-class v8, Ldev/cobalt/coat/javabridge/CobaltJavaScriptInterface;

    invoke-static/range {v3 .. v9}, Lorg/jni_zero/GEN_JNI;->cobalt_org_chromium_content_browser_JavascriptInjectorImpl_addInterface(JLjava/lang/Object;Ljava/lang/Object;Ljava/lang/Object;Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;

    move-result-object v1

    return-void
.end method
"""

GUARD = """.class public final Ldev/cobalt/shell/StartupGuardNavigationObserver;
.super Lbuh;
"""

OBSERVER_BASE = """.class public Lbuh;
.super Ljava/lang/Object;

.method public constructor <init>(Lcobalt/org/chromium/content_public/browser/WebContents;)V
    .locals 0
    return-void
.end method

.method public didFinishNavigationInPrimaryMainFrame(Lcobalt/org/chromium/content_public/browser/NavigationHandle;)V
    .locals 0
    return-void
.end method

.method public primaryMainDocumentElementAvailable()V
    .locals 0
    return-void
.end method

.method public webContentsDestroyed()V
    .locals 0
    return-void
.end method
"""

AVAILABILITY = """.class public Ldlk;
.super Ljava/lang/Object;

.method public final f(Landroid/content/Context;I)I
    .locals 2
    invoke-static {p1, p2}, Ldmb;->b(Landroid/content/Context;I)I
    move-result p0
    return p0
.end method

.method public final g(Landroid/content/Context;ILjava/lang/String;)Landroid/content/Intent;
    .locals 1
    const-string v0, "gcore_"
    const/4 v0, 0x0
    return-object v0
.end method
"""

PRIMES = """.class public final Lelc;
.super Ljava/lang/Object;

.method public static b()Z
    .locals 1
    const/4 v0, 0x0
    return v0
.end method

.method public final a()Z
    .locals 3
    const-string v0, "com.android.vending"
    const-string v1, "com.google.android.youtube.tv"
    const-string v2, "com.google.android.youtube.tvunplugged"
    const/4 v0, 0x0
    return v0
.end method
"""

BRIDGE = """.class public abstract Ldev/cobalt/coat/BaseStarboardBridge;
.super Ljava/lang/Object;

.method protected getUserAgentAuxField()Ljava/lang/String;
    .locals 5
    new-instance v0, Ljava/lang/StringBuilder;
    const-string v0, "computed"
    return-object v0
.end method
"""


def gms_smali(n: int) -> str:
    lines = [".class public final Lgmsuser;", ".super Ljava/lang/Object;", "",
             ".method public static a()V", "    .locals 1"]
    for i in range(n):
        lines.append('    const-string v0, "com.google.android.gms"')
    lines += [
        '    const-string v0, "com.google.android.gms.droidguard.service.START"',
        '    const-string/jumbo v0, "com.google.android.gsf.login"',
        '    const-string v0, "com.google.android.gms.cast.tv.action.LAUNCH"',  # not in the list: kept
        '    const-string v0, "com.google.android.gmsx"',  # not exact: kept
        "    return-void", ".end method", ""]
    return "\n".join(lines)


def make(root: Path, gms_strings: int = 32) -> Path:
    files = {
        "AndroidManifest.xml": MANIFEST,
        "apktool.yml": APKTOOL_YML,
        "smali/dev/cobalt/shell/Shell.smali": SHELL,
        "smali/dev/cobalt/shell/StartupGuardNavigationObserver.smali": GUARD,
        "smali/buh.smali": OBSERVER_BASE,
        "smali_classes2/dlk.smali": AVAILABILITY,
        "smali_classes2/elc.smali": PRIMES,
        "smali_classes2/gmsuser.smali": gms_smali(gms_strings),
        "smali_classes2/dev/cobalt/coat/BaseStarboardBridge.smali": BRIDGE,
    }
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    # resources the branding patch replaces (content irrelevant)
    for rel in ["mipmap-mdpi/ic_launcher.png", "mipmap-hdpi/ic_launcher.png", "mipmap-xhdpi/ic_launcher.png",
                "mipmap-xxhdpi/ic_launcher.png", "mipmap-xxxhdpi/ic_launcher.png", "mipmap-mdpi/ic_app.png",
                "mipmap-hdpi/ic_app.png", "mipmap-xhdpi/ic_app.png", "drawable/app_banner.png"]:
        p = root / "res" / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"old")
    return root

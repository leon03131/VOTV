package app.votv.host;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;

/**
 * Where plugin code comes from:
 *  1. dev mode: system property debug.votv.dev = "http://<pc>:8080" -> bundle.js from the PC
 *  2. downloaded update in <filesDir>/votv/bundle.js (verified by sha256, with 3-boot safe mode)
 *  3. the bundle shipped in the APK (assets/votv/bundle.js)
 */
final class Plugins {
    private static final String PREFS = "votv_updates";
    private static final int MAX_BOOT_FAILS = 3;
    static final String DEFAULT_REPO = "leon03131/votv";
    static final String DEFAULT_APK_URL = "https://sadthers.dev/votv/";

    private Plugins() {}

    private static String devCache;
    private static long devCacheAt;

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static File downloadedFile(Context c) {
        return new File(new File(c.getFilesDir(), "votv"), "bundle.js");
    }

    static String appVersion(Context c) {
        try {
            return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    static String source(Context c) {
        if (devUrl(c) != null) return "dev";
        File f = downloadedFile(c);
        SharedPreferences p = prefs(c);
        if (f.exists() && p.getInt("bootFails", 0) < MAX_BOOT_FAILS && p.getString("sha256", "").length() == 64) {
            return "downloaded";
        }
        return "bundled";
    }

    static String pluginVersion(Context c) {
        if ("dev".equals(source(c))) return "dev";
        if ("downloaded".equals(source(c))) return prefs(c).getString("pluginVersion", appVersion(c));
        return appVersion(c);
    }

    static String latestApkVersion(Context c) {
        return prefs(c).getString("latestApkVersion", "");
    }

    static String latestApkUrl(Context c) {
        return prefs(c).getString("latestApkUrl", "");
    }

    /**
     * Dev mode is switched on from the PC with
     *   adb shell setprop debug.votv.dev http://<pc>:8080
     * (debug.* properties are writable by adb and readable by apps; off: setprop debug.votv.dev "")
     */
    static synchronized String devUrl(Context c) {
        long now = System.currentTimeMillis();
        if (now - devCacheAt < 5000) return devCache;
        devCacheAt = now;
        devCache = null;
        try {
            Process p = new ProcessBuilder("getprop", "debug.votv.dev").redirectErrorStream(true).start();
            String s = new String(readAll(p.getInputStream()), StandardCharsets.UTF_8).trim();
            p.waitFor();
            while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
            if (s.startsWith("http://") || s.startsWith("https://")) devCache = s;
        } catch (Exception e) {
            // no dev mode
        }
        return devCache;
    }

    static String bundle(Context c) {
        String dev = devUrl(c);
        for (int attempt = 1; dev != null && attempt <= 2; attempt++) {
            HttpURLConnection conn = null;
            try {
                conn = Http.open(new URL(dev + "/bundle.js"), false);
                conn.setConnectTimeout(3000);
                conn.setReadTimeout(5000);
                conn.setUseCaches(false);
                if (conn.getResponseCode() == 200) {
                    String js = new String(readAll(conn.getInputStream()), StandardCharsets.UTF_8);
                    Log.i(Host.TAG, "bundle from dev server " + dev + " (" + js.length() + " chars)");
                    return js;
                }
                Log.w(Host.TAG, "dev server answered " + conn.getResponseCode());
                break;
            } catch (Exception e) {
                Log.w(Host.TAG, "dev server unreachable (attempt " + attempt + "): " + e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
        if (dev != null) Log.w(Host.TAG, "using the plugins shipped in the APK");

        File dl = downloadedFile(c);
        if (dl.exists()) {
            SharedPreferences p = prefs(c);
            int fails = p.getInt("bootFails", 0);
            String expectedHash = p.getString("sha256", "");
            if (fails >= MAX_BOOT_FAILS) {
                Log.w(Host.TAG, "safe mode: rolling back downloaded plugins after " + fails + " failed boots");
                rollback(c);
            } else {
                try {
                    byte[] bytes = readAll(new FileInputStream(dl));
                    String actualHash = sha256Hex(bytes);
                    if (!expectedHash.isEmpty() && expectedHash.equalsIgnoreCase(actualHash)) {
                        p.edit().putInt("bootFails", fails + 1).apply();
                        Log.i(Host.TAG, "bundle from downloaded update " + p.getString("pluginVersion", "?") + " (" + bytes.length + " bytes)");
                        return new String(bytes, StandardCharsets.UTF_8);
                    }
                    Log.w(Host.TAG, "downloaded bundle sha256 mismatch, rolling back");
                    rollback(c);
                } catch (Exception e) {
                    Log.w(Host.TAG, "failed reading downloaded bundle, rolling back", e);
                    rollback(c);
                }
            }
        }

        try {
            return new String(readAll(c.getAssets().open("votv/bundle.js")), StandardCharsets.UTF_8);
        } catch (IOException e) {
            Log.e(Host.TAG, "no bundled plugins", e);
            return "";
        }
    }

    static void markBootOk(Context c) {
        if (c == null) return;
        SharedPreferences p = prefs(c);
        if (p.getInt("bootFails", 0) != 0) {
            p.edit().putInt("bootFails", 0).apply();
            Log.i(Host.TAG, "plugins boot verified (safe-mode counter reset)");
        }
    }

    static void rollback(Context c) {
        if (c == null) return;
        File dl = downloadedFile(c);
        File tmp = new File(dl.getParentFile(), "bundle.js.tmp");
        if (tmp.exists()) tmp.delete();
        if (dl.exists()) dl.delete();
        prefs(c).edit().remove("pluginVersion").remove("sha256").remove("bootFails").apply();
        Log.i(Host.TAG, "rolled back to bundled plugins");
    }

    static String checkUpdate(Context c, String repo) {
        JSONObject out = new JSONObject();
        try {
            String curApp = appVersion(c);
            String curPlugin = pluginVersion(c);
            out.put("ok", false);
            out.put("updated", false);
            out.put("currentPluginVersion", curPlugin);
            out.put("currentApkVersion", curApp);

            Map<String, String> ghHeaders = new HashMap<String, String>();
            ghHeaders.put("Accept", "application/vnd.github+json");
            ghHeaders.put("User-Agent", "VOTV-Host/" + Host.VERSION);

            byte[] relBytes;
            try {
                relBytes = Http.getBytes("https://api.github.com/repos/" + repo + "/releases/latest", ghHeaders, 15000);
            } catch (Http.HttpStatusException he) {
                if (he.status == 404) {
                    out.put("ok", true);
                    out.put("status", "no-releases");
                    return out.toString();
                }
                throw he;
            }

            JSONObject rel = new JSONObject(new String(relBytes, StandardCharsets.UTF_8));
            String tag = rel.optString("tag_name", "");
            String htmlUrl = rel.optString("html_url", "https://github.com/" + repo + "/releases/latest");
            JSONArray assets = rel.optJSONArray("assets");
            String manifestUrl = "";
            if (assets != null) {
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject a = assets.getJSONObject(i);
                    if ("manifest.json".equals(a.optString("name"))) {
                        manifestUrl = a.optString("browser_download_url", "");
                        break;
                    }
                }
            }

            if (manifestUrl.isEmpty()) {
                boolean apkNewer = isNewerVersion(tag, curApp);
                prefs(c).edit()
                        .putLong("lastCheckAt", System.currentTimeMillis())
                        .putString("latestApkVersion", tag)
                        .putString("latestApkUrl", DEFAULT_APK_URL)
                        .apply();
                out.put("ok", true);
                out.put("status", "no-manifest");
                out.put("apkUpdateAvailable", apkNewer);
                out.put("latestApkVersion", tag);
                out.put("apkUrl", DEFAULT_APK_URL);
                return out.toString();
            }

            byte[] mfBytes = Http.getBytes(manifestUrl, ghHeaders, 15000);
            JSONObject mf = new JSONObject(new String(mfBytes, StandardCharsets.UTF_8));
            String remotePlugin = mf.optString("pluginVersion", "");
            int minApi = mf.optInt("minHostApi", 1);
            String bundleUrl = mf.optString("bundleUrl", "");
            String sha256 = mf.optString("sha256", "");
            String remoteApk = mf.optString("apkVersion", tag);
            String apkUrl = mf.optString("apkUrl", DEFAULT_APK_URL);
            boolean apkNewer = isNewerVersion(remoteApk, curApp);

            prefs(c).edit()
                    .putLong("lastCheckAt", System.currentTimeMillis())
                    .putString("latestApkVersion", remoteApk)
                    .putString("latestApkUrl", apkUrl)
                    .apply();

            out.put("apkUpdateAvailable", apkNewer);
            out.put("latestApkVersion", remoteApk);
            out.put("apkUrl", apkUrl);
            out.put("pluginVersion", remotePlugin);

            if (!remotePlugin.isEmpty() && !remotePlugin.equals(curPlugin)
                    && minApi <= VotHost.API && bundleUrl.startsWith("https://") && sha256.length() == 64) {
                byte[] newBundle = Http.getBytes(bundleUrl, ghHeaders, 30000);
                String actualHash = sha256Hex(newBundle);
                if (!sha256.equalsIgnoreCase(actualHash)) {
                    throw new IllegalStateException("bundle sha256 mismatch");
                }
                File dst = downloadedFile(c);
                File dir = dst.getParentFile();
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("cannot create " + dir);
                File tmp = new File(dir, "bundle.js.tmp");
                FileOutputStream fos = new FileOutputStream(tmp);
                try {
                    fos.write(newBundle);
                    fos.getFD().sync();
                } finally {
                    fos.close();
                }
                if (dst.exists() && !dst.delete()) {
                    Log.w(Host.TAG, "could not delete old bundle before rename");
                }
                if (!tmp.renameTo(dst)) throw new IOException("rename failed");
                prefs(c).edit()
                        .putString("pluginVersion", remotePlugin)
                        .putString("sha256", sha256.toLowerCase())
                        .putInt("bootFails", 0)
                        .apply();
                out.put("ok", true);
                out.put("status", "updated");
                out.put("updated", true);
                out.put("currentPluginVersion", remotePlugin);
                Log.i(Host.TAG, "updated plugins to " + remotePlugin);
                return out.toString();
            }

            out.put("ok", true);
            out.put("status", minApi > VotHost.API ? "needs-newer-apk" : "up-to-date");
            return out.toString();
        } catch (Exception e) {
            Log.w(Host.TAG, "update check failed: " + e);
            try {
                out.put("ok", false);
                out.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
            } catch (Exception ignored) {
            }
            return out.toString();
        }
    }

    static boolean isNewerVersion(String remote, String local) {
        if (remote == null || remote.isEmpty()) return false;
        String r = remote.startsWith("v") ? remote.substring(1) : remote;
        String l = local == null ? "" : (local.startsWith("v") ? local.substring(1) : local);
        if (r.equals(l)) return false;
        String[] rp = r.split("[.\\-]");
        String[] lp = l.split("[.\\-]");
        int n = Math.max(rp.length, lp.length);
        for (int i = 0; i < n; i++) {
            String a = i < rp.length ? rp[i] : "0";
            String b = i < lp.length ? lp[i] : "0";
            boolean aNum = a.matches("\\d+");
            boolean bNum = b.matches("\\d+");
            if (aNum && bNum) {
                long ai = Long.parseLong(a);
                long bi = Long.parseLong(b);
                if (ai != bi) return ai > bi;
            } else {
                int cmp = a.compareTo(b);
                if (cmp != 0) return cmp > 0;
            }
        }
        return false;
    }

    static String sha256Hex(byte[] bytes) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] digest = md.digest(bytes);
        StringBuilder sb = new StringBuilder(digest.length * 2);
        for (byte b : digest) {
            sb.append(String.format("%02x", b & 0xff));
        }
        return sb.toString();
    }

    static byte[] readAll(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            in.close();
        }
    }
}

package app.votv.host;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * window.VotHost — the stable API plugins talk to. Calls arrive on Cobalt's bridge thread and
 * are synchronous; slow work (HTTP) is async and answered via window.__votvHost.resolve().
 *
 * Keep this surface small and backwards compatible: plugins update without a new APK.
 */
public final class VotHost {
    /** Bump when methods are added; plugins check it to stay compatible. */
    public static final int API = 4;

    private static final ExecutorService pool = Executors.newFixedThreadPool(4);
    private static final AtomicInteger ids = new AtomicInteger();

    private SharedPreferences prefs() {
        return Host.context().getSharedPreferences("votv", Context.MODE_PRIVATE);
    }

    @JsApi
    public String version() {
        try {
            Context c = Host.context();
            JSONObject o = new JSONObject();
            o.put("host", Host.VERSION);
            o.put("api", API);
            o.put("package", c.getPackageName());
            o.put("app", c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName);
            // The process ABI (a 32-bit build on a 64-bit TV runs as 32-bit), not the device's.
            o.put("abi", System.getProperty("os.arch") + (android.os.Process.is64Bit() ? " (64-bit)" : " (32-bit)"));
            o.put("deviceAbis", android.text.TextUtils.join(",", Build.SUPPORTED_ABIS));
            o.put("android", Build.VERSION.RELEASE);
            o.put("device", Build.MANUFACTURER + " " + Build.MODEL);
            String dev = Plugins.devUrl(c);
            o.put("dev", dev != null);
            if (dev != null) o.put("devUrl", dev);
            o.put("pluginSource", Plugins.source(c));
            o.put("pluginVersion", Plugins.pluginVersion(c));
            String latestApk = Plugins.latestApkVersion(c);
            if (!latestApk.isEmpty()) {
                o.put("latestApkVersion", latestApk);
                o.put("latestApkUrl", Plugins.latestApkUrl(c));
            }
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @JsApi
    public void log(String level, String message) {
        String msg = String.valueOf(message);
        if ("e".equals(level)) Log.e(Host.TAG, msg);
        else if ("w".equals(level)) Log.w(Host.TAG, msg);
        else Log.i(Host.TAG, msg);
    }

    /** The page asks for plugins: evaluate core + enabled plugins in it (async). */
    @JsApi
    public void requestBundle() {
        // Off the bridge thread: the page's JS waits while a bridge call runs.
        pool.execute(new Runnable() {
            @Override
            public void run() {
                Host.evaluate(Plugins.bundle(Host.context()));
            }
        });
    }

    // ---- voice-over audio (API 3): see AudioPlayer --------------------------------------

    @JsApi
    public void audioLoad(String url, double startSec) {
        AudioPlayer.load(url, startSec);
    }

    @JsApi
    public void audioPlay() {
        AudioPlayer.play();
    }

    @JsApi
    public void audioPause() {
        AudioPlayer.pause();
    }

    @JsApi
    public void audioSeek(double sec) {
        AudioPlayer.seek(sec);
    }

    @JsApi
    public void audioRate(double rate) {
        AudioPlayer.rate(rate);
    }

    @JsApi
    public void audioVolume(double volume) {
        AudioPlayer.volume(volume);
    }

    @JsApi
    public void audioRelease() {
        AudioPlayer.release();
    }

    /** {state, position, duration, rate, volume, error?}; state: idle preparing ready playing paused ended error */
    @JsApi
    public String audioState() {
        return AudioPlayer.state();
    }

    @JsApi
    public String storageGet(String key) {
        return prefs().getString("js:" + key, null);
    }

    @JsApi
    public void storageSet(String key, String value) {
        SharedPreferences.Editor e = prefs().edit();
        if (value == null) e.remove("js:" + key);
        else e.putString("js:" + key, value);
        e.apply();
    }

    /**
     * Start an HTTP request without CORS. `json`: {url, method, headers, body | bodyBase64,
     * responseType: "text" | "base64", timeout}. Returns an id; the result arrives as
     * window.__votvHost.resolve(id, resultJson).
     */
    @JsApi
    public int request(final String json) {
        final int id = ids.incrementAndGet();
        pool.execute(new Runnable() {
            @Override
            public void run() {
                String result = Http.perform(json, Plugins.devUrl(Host.context()));
                Host.evaluate("window.__votvHost&&window.__votvHost.resolve(" + id + "," + JSONObject.quote(result) + ")");
            }
        });
        return id;
    }

    @JsApi
    public void toast(final String message) {
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(Host.context(), String.valueOf(message), Toast.LENGTH_LONG).show();
            }
        });
    }

    @JsApi
    public void markBootOk() {
        Plugins.markBootOk(Host.context());
    }

    @JsApi
    public void rollbackPlugins() {
        Plugins.rollback(Host.context());
    }

    @JsApi
    public int checkUpdate() {
        final int id = ids.incrementAndGet();
        pool.execute(new Runnable() {
            @Override
            public void run() {
                String result = Plugins.checkUpdate(Host.context(), Plugins.DEFAULT_REPO);
                Host.evaluate("window.__votvHost&&window.__votvHost.resolve(" + id + "," + JSONObject.quote(result) + ")");
            }
        });
        return id;
    }

    @JsApi
    public void reload() {
        Host.evaluate("location.reload()");
    }
}

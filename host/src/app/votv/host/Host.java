package app.votv.host;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Collections;
import java.util.Map;
import java.util.WeakHashMap;

/**
 * Glue between Cobalt and the plugins. Called from smali hooks in dev.cobalt.shell.Shell:
 *  - onInjector: right before Cobalt registers its own JS objects -> we add window.VotHost
 *  - onWebContents: when the page's WebContents is created -> navigation observer + injection
 *
 * Cobalt classes are reached by reflection so this code builds against plain android.jar.
 */
public final class Host {
    public static final String TAG = "VOTV";
    public static final String VERSION = "0.5.0";
    static final String JS_NAME = "VotHost";
    static final String ORIGIN = "https://www.youtube.com";

    /**
     * Runs in the page once a second (tiny): if this document has no plugins yet, ask the host to
     * push them. youtube.com/tv enforces Trusted Types, so the page can't eval() the bundle itself;
     * code run by evaluateJavaScript from the browser side is not subject to the page's CSP.
     */
    static final String BOOT =
            "(function(){if(window.__votv||window.__votvTried||typeof VotHost==='undefined')return;"
            + "window.__votvTried=1;try{VotHost.requestBundle()}catch(e){}})()";

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final Map<Object, Boolean> injectors = Collections.synchronizedMap(new WeakHashMap<Object, Boolean>());
    private static volatile Object webContents;
    private static Object navObserver;
    private static Method evaluateJs;
    private static Context context;

    private Host() {}

    // ---- hooks ---------------------------------------------------------------

    /** Hook: JavascriptInjectorImpl is ready; add window.VotHost (once per injector). */
    public static void onInjector(Object injector) {
        if (injector == null || injectors.put(injector, Boolean.TRUE) != null) return;
        try {
            long ptr = longField(injector);
            if (ptr == 0) return;
            Class<?> jni = Class.forName("org.jni_zero.GEN_JNI");
            Method add = jni.getMethod("cobalt_org_chromium_content_browser_JavascriptInjectorImpl_addInterface",
                    long.class, Object.class, Object.class, Object.class, Object.class, Object.class);
            Object errors = add.invoke(null, ptr, injector, new VotHost(), JS_NAME, JsApi.class,
                    Collections.singletonList(ORIGIN));
            Log.i(TAG, "VotHost added, errors=" + errors);
        } catch (Throwable t) {
            Log.e(TAG, "addInterface failed", t);
        }
    }

    /** Hook: the main WebContents exists (before the first page load). */
    public static void onWebContents(Object wc) {
        webContents = wc;
        try {
            Class<?> wcClass = Class.forName("cobalt.org.chromium.content_public.browser.WebContents");
            navObserver = Class.forName("app.votv.host.NavObserver").getConstructor(wcClass).newInstance(wc);
        } catch (Throwable t) {
            Log.e(TAG, "navigation observer failed", t);
        }
        main.removeCallbacks(poll);
        main.postDelayed(poll, 1000);
        Log.i(TAG, "host " + VERSION + " attached");
    }

    /** NavObserver: new document has its <html> element; inject as early as possible. */
    public static void onDocument() {
        inject();
    }

    public static void onNavigation() {
        inject();
    }

    public static void onWebContentsDestroyed() {
        webContents = null;
        main.removeCallbacks(poll);
    }

    // Fallback in case an early event was missed (cheap: one global check per second).
    private static final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (webContents == null) return;
            inject();
            main.postDelayed(this, 1000);
        }
    };

    static void inject() {
        evaluate(BOOT);
    }

    // ---- page access ---------------------------------------------------------

    /** Run JS in the main frame (fire and forget). Safe to call from any thread. */
    public static void evaluate(final String js) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post(new Runnable() {
                @Override
                public void run() {
                    evaluate(js);
                }
            });
            return;
        }
        Object wc = webContents;
        if (wc == null) return;
        try {
            long ptr = longField(wc);
            if (ptr == 0) return;
            if (evaluateJs == null) {
                evaluateJs = Class.forName("org.jni_zero.GEN_JNI").getMethod(
                        "cobalt_org_chromium_content_browser_webcontents_WebContentsImpl_evaluateJavaScript",
                        long.class, Object.class, Object.class);
            }
            evaluateJs.invoke(null, ptr, js, null);
        } catch (Throwable t) {
            Log.w(TAG, "evaluate failed: " + t);
        }
    }

    public static Context context() {
        if (context == null) {
            try {
                context = (Context) Class.forName("android.app.ActivityThread")
                        .getMethod("currentApplication").invoke(null);
            } catch (Throwable t) {
                Log.e(TAG, "no application context", t);
            }
        }
        return context;
    }

    /** The only instance long field of a Chromium Java peer is its native pointer. */
    static long longField(Object o) throws IllegalAccessException {
        for (Class<?> c = o.getClass(); c != null && c != Object.class; c = c.getSuperclass()) {
            for (Field f : c.getDeclaredFields()) {
                if (f.getType() == long.class && !Modifier.isStatic(f.getModifiers())) {
                    f.setAccessible(true);
                    return f.getLong(o);
                }
            }
        }
        return 0;
    }
}

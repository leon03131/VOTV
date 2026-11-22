package app.votv.host;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.PlaybackParams;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

/**
 * Native player for the translated voice-over (an mp3 URL from Yandex). Cobalt can't play it:
 * no <audio> support and WebAudio can't decode mp3. The vot plugin drives it from JS and keeps
 * it in sync with the <video> (play/pause/seek/rate); this class only does what it is told.
 *
 * All MediaPlayer calls run on the main thread; state is published through volatile fields.
 */
final class AudioPlayer {
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static MediaPlayer mp;
    private static int generation;
    private static volatile String state = "idle"; // idle preparing ready playing paused ended error
    private static volatile String error = "";
    private static volatile int durationMs;
    private static volatile float rate = 1f;
    private static volatile float volume = 1f;
    private static volatile boolean seeking;
    private static boolean lifecycleHooked;

    private AudioPlayer() {}

    private static void onMain(Runnable r) {
        if (Looper.myLooper() == Looper.getMainLooper()) r.run();
        else main.post(r);
    }

    static void load(final String url, final double startSec) {
        onMain(new Runnable() {
            @Override
            public void run() {
                hookLifecycle();
                useWorkingTls();
                releaseNow();
                final int gen = ++generation;
                state = "preparing";
                error = "";
                durationMs = 0;
                try {
                    final MediaPlayer p = new MediaPlayer();
                    mp = p;
                    p.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build());
                    p.setVolume(volume, volume);
                    p.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
                        @Override
                        public void onPrepared(MediaPlayer m) {
                            if (gen != generation) return;
                            durationMs = Math.max(0, m.getDuration());
                            if (startSec > 0) seekNow(startSec);
                            state = "ready";
                        }
                    });
                    p.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                        @Override
                        public void onCompletion(MediaPlayer m) {
                            if (gen == generation) state = "ended";
                        }
                    });
                    p.setOnSeekCompleteListener(new MediaPlayer.OnSeekCompleteListener() {
                        @Override
                        public void onSeekComplete(MediaPlayer m) {
                            if (gen == generation) seeking = false;
                        }
                    });
                    p.setOnErrorListener(new MediaPlayer.OnErrorListener() {
                        @Override
                        public boolean onError(MediaPlayer m, int what, int extra) {
                            if (gen != generation) return true;
                            state = "error";
                            error = "MediaPlayer error " + what + "/" + extra;
                            Log.w(Host.TAG, "audio: " + error);
                            return true;
                        }
                    });
                    p.setDataSource(url);
                    p.prepareAsync();
                } catch (Exception e) {
                    state = "error";
                    error = e.getClass().getSimpleName() + ": " + e.getMessage();
                    Log.w(Host.TAG, "audio load failed: " + error);
                }
            }
        });
    }

    static void play() {
        onMain(new Runnable() {
            @Override
            public void run() {
                if (mp == null || !("ready".equals(state) || "paused".equals(state))) return;
                try {
                    mp.start();
                    applyRate();
                    state = "playing";
                } catch (Exception e) {
                    Log.w(Host.TAG, "audio play: " + e);
                }
            }
        });
    }

    static void pause() {
        onMain(new Runnable() {
            @Override
            public void run() {
                if (mp == null || !"playing".equals(state)) return;
                try {
                    mp.pause();
                    state = "paused";
                } catch (Exception e) {
                    Log.w(Host.TAG, "audio pause: " + e);
                }
            }
        });
    }

    static void seek(final double sec) {
        onMain(new Runnable() {
            @Override
            public void run() {
                seekNow(sec);
            }
        });
    }

    private static void seekNow(double sec) {
        if (mp == null) return;
        try {
            seeking = true;
            long ms = Math.max(0, (long) (sec * 1000));
            if (Build.VERSION.SDK_INT >= 26) mp.seekTo(ms, MediaPlayer.SEEK_CLOSEST);
            else mp.seekTo((int) ms);
            if ("ended".equals(state)) state = "paused";
        } catch (Exception e) {
            seeking = false;
            Log.w(Host.TAG, "audio seek: " + e);
        }
    }

    /** Speed is applied only while playing: setPlaybackParams on a paused player starts it. */
    static void rate(final double r) {
        onMain(new Runnable() {
            @Override
            public void run() {
                rate = (float) Math.max(0.25, Math.min(4, r));
                if ("playing".equals(state)) applyRate();
            }
        });
    }

    private static void applyRate() {
        if (mp == null) return;
        try {
            PlaybackParams params = mp.getPlaybackParams();
            if (Math.abs(params.getSpeed() - rate) > 0.001f) mp.setPlaybackParams(params.setSpeed(rate));
        } catch (Exception e) {
            Log.w(Host.TAG, "audio rate: " + e);
        }
    }

    static void volume(final double v) {
        onMain(new Runnable() {
            @Override
            public void run() {
                volume = (float) Math.max(0, Math.min(1, v));
                if (mp != null) mp.setVolume(volume, volume);
            }
        });
    }

    static void release() {
        onMain(new Runnable() {
            @Override
            public void run() {
                generation++;
                releaseNow();
            }
        });
    }

    private static void releaseNow() {
        if (mp != null) {
            try {
                mp.release();
            } catch (Exception ignored) {
            }
            mp = null;
        }
        seeking = false;
        state = "idle";
    }

    static String state() {
        JSONObject o = new JSONObject();
        try {
            o.put("state", state);
            double pos = 0;
            MediaPlayer p = mp;
            String s = state;
            if (p != null && !"preparing".equals(s) && !"idle".equals(s) && !"error".equals(s)) {
                try {
                    pos = p.getCurrentPosition() / 1000.0;
                } catch (Exception ignored) {
                }
            }
            o.put("position", pos);
            o.put("duration", durationMs / 1000.0);
            o.put("rate", rate);
            o.put("volume", volume);
            o.put("seeking", seeking);
            if (error.length() > 0) o.put("error", error);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    /**
     * MediaPlayer downloads https URLs inside our process through HttpsURLConnection's default
     * socket factory - which the app replaces with one that refuses to work without Google Play
     * services ("Attempted to use SSL unpatched"). Make the platform TLS context the default.
     * Cobalt's own networking is native and does not use it.
     */
    private static void useWorkingTls() {
        try {
            javax.net.ssl.HttpsURLConnection.setDefaultSSLSocketFactory(Http.tls());
        } catch (Exception e) {
            Log.w(Host.TAG, "audio: cannot set TLS factory: " + e);
        }
    }

    /** Pause the voice-over when the app leaves the screen (the page's JS may be frozen then). */
    private static void hookLifecycle() {
        if (lifecycleHooked) return;
        Context c = Host.context();
        if (!(c instanceof Application)) return;
        lifecycleHooked = true;
        ((Application) c).registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityPaused(Activity a) { pause(); }
            @Override public void onActivityCreated(Activity a, Bundle b) {}
            @Override public void onActivityStarted(Activity a) {}
            @Override public void onActivityResumed(Activity a) {}
            @Override public void onActivityStopped(Activity a) {}
            @Override public void onActivitySaveInstanceState(Activity a, Bundle b) {}
            @Override public void onActivityDestroyed(Activity a) {}
        });
    }
}

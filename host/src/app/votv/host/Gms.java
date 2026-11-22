package app.votv.host;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;

/** Google services availability, answered by microG instead of Google Play services. */
public final class Gms {
    public static final String MICROG = "app.revanced.android.gms";

    // Values of ConnectionResult.
    private static final int SUCCESS = 0;
    private static final int SERVICE_MISSING = 1;
    private static final int SERVICE_DISABLED = 3;

    private Gms() {}

    /** Called instead of GoogleApiAvailability.isGooglePlayServicesAvailable(). */
    public static int availability(Context context) {
        try {
            ApplicationInfo info = context.getPackageManager().getApplicationInfo(MICROG, 0);
            return info.enabled ? SUCCESS : SERVICE_DISABLED;
        } catch (PackageManager.NameNotFoundException e) {
            // No microG: the app signs in with a code on yt.be/activate.
            return SERVICE_MISSING;
        }
    }
}

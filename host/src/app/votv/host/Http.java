package app.votv.host;

import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NoRouteToHostException;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManagerFactory;

/**
 * HTTP for plugins (no CORS). Plain http:// only to the dev server.
 *
 * Networks with a half-working IPv6 (an address but no route out) make Java hang on the IPv6
 * address. After such a failure we retry over IPv4 and keep using IPv4 from then on.
 */
final class Http {
    private static volatile boolean ipv6Broken;
    private static SSLSocketFactory tls;

    /**
     * Our own TLS context on the system CA store. The app replaces the JVM default
     * (HttpsURLConnection.getDefaultSSLSocketFactory) with one that refuses to work until Google
     * Play services patch the security provider - which never happens without GMS.
     */
    static synchronized SSLSocketFactory tls() throws Exception {
        if (tls == null) {
            // The app also registers its own Security provider whose "TLS" context is the guarded
            // one; take TLS straight from the platform provider (Conscrypt) instead.
            java.security.Provider platform = null;
            for (java.security.Provider p : java.security.Security.getProviders()) {
                boolean appClass = p.getClass().getName().indexOf('.') < 0; // obfuscated app code
                if (!appClass && p.getService("SSLContext", "TLS") != null) {
                    platform = p;
                    break;
                }
            }
            if (platform == null) throw new IllegalStateException("no platform TLS provider");
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init((java.security.KeyStore) null);
            SSLContext ctx = SSLContext.getInstance("TLS", platform);
            ctx.init(null, tmf.getTrustManagers(), null);
            tls = ctx.getSocketFactory();
            Log.i(Host.TAG, "TLS via " + platform.getName());
        }
        return tls;
    }

    private Http() {}

    static String perform(String json, String devUrl) {
        JSONObject res = new JSONObject();
        try {
            JSONObject req = new JSONObject(json);
            String url = req.getString("url");
            if (!url.startsWith("https://") && !(devUrl != null && url.startsWith(devUrl + "/"))) {
                throw new IllegalArgumentException("only https:// URLs are allowed");
            }
            boolean forceIpv4 = req.optBoolean("forceIpv4", false); // used by tests
            try {
                execute(req, new URL(url), ipv6Broken || forceIpv4, res);
            } catch (ConnectFailed e) {
                // Only a failed *connect* is retried: nothing was sent, so a POST can't run twice.
                if (ipv6Broken || forceIpv4) throw e.cause;
                Log.w(Host.TAG, "connect failed (" + e.cause.getMessage() + "), retrying over IPv4");
                execute(req, new URL(url), true, res);
                ipv6Broken = true;
            }
        } catch (Exception e) {
            try {
                res.put("status", 0);
                res.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
            } catch (Exception ignored) {
            }
        }
        return res.toString();
    }

    /** Download bytes from an https:// URL, following HTTPS redirects with our TLS + IPv4 fallback. */
    static byte[] getBytes(String url, Map<String, String> headers, int timeout) throws Exception {
        try {
            return getBytesOnce(url, headers, timeout, ipv6Broken);
        } catch (ConnectFailed e) {
            if (ipv6Broken) throw e.cause;
            Log.w(Host.TAG, "connect failed (" + e.cause.getMessage() + "), retrying over IPv4");
            byte[] data = getBytesOnce(url, headers, timeout, true);
            ipv6Broken = true;
            return data;
        }
    }

    private static byte[] getBytesOnce(String urlStr, Map<String, String> headers, int timeout, boolean ipv4) throws Exception {
        String cur = urlStr;
        for (int hop = 0; hop < 6; hop++) {
            URL url = new URL(cur);
            if (!"https".equals(url.getProtocol())) throw new IllegalArgumentException("only https:// URLs are allowed");
            HttpURLConnection conn = open(url, ipv4);
            try {
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(ipv4 ? timeout : Math.min(timeout, 6000));
                conn.setReadTimeout(timeout);
                conn.setInstanceFollowRedirects(false);
                conn.setUseCaches(false);
                if (headers != null) {
                    for (Map.Entry<String, String> e : headers.entrySet()) {
                        conn.setRequestProperty(e.getKey(), e.getValue());
                    }
                }
                try {
                    conn.connect();
                } catch (SocketTimeoutException | ConnectException | NoRouteToHostException e) {
                    throw new ConnectFailed(e);
                }
                int status = conn.getResponseCode();
                if (status >= 300 && status < 400) {
                    String loc = conn.getHeaderField("Location");
                    if (loc == null || loc.isEmpty()) throw new IOException("HTTP " + status + " without Location");
                    cur = new URL(url, loc).toString();
                    continue;
                }
                if (status < 200 || status >= 300) {
                    throw new HttpStatusException(status);
                }
                return Plugins.readAll(conn.getInputStream());
            } finally {
                conn.disconnect();
            }
        }
        throw new IOException("too many redirects");
    }

    static final class HttpStatusException extends IOException {
        final int status;
        HttpStatusException(int status) {
            super("HTTP " + status);
            this.status = status;
        }
    }

    private static void execute(JSONObject req, URL url, boolean ipv4, JSONObject res) throws Exception {
        HttpURLConnection conn = open(url, ipv4);
        try {
            conn.setRequestMethod(req.optString("method", "GET").toUpperCase());
            int timeout = req.optInt("timeout", 30000);
            // Fail fast on the first connect so an IPv4 retry still fits in the caller's timeout.
            conn.setConnectTimeout(ipv4 ? timeout : Math.min(timeout, 6000));
            conn.setReadTimeout(timeout);
            conn.setInstanceFollowRedirects(true);
            if (req.optBoolean("noCache", true)) conn.setUseCaches(false);
            JSONObject headers = req.optJSONObject("headers");
            if (headers != null) {
                for (Iterator<String> it = headers.keys(); it.hasNext(); ) {
                    String k = it.next();
                    conn.setRequestProperty(k, headers.getString(k));
                }
            }
            byte[] body = null;
            if (req.has("bodyBase64")) body = Base64.decode(req.getString("bodyBase64"), Base64.DEFAULT);
            else if (req.has("body") && !req.isNull("body")) body = req.getString("body").getBytes("UTF-8");
            if (body != null) {
                conn.setDoOutput(true);
                conn.setFixedLengthStreamingMode(body.length);
            }
            try {
                conn.connect();
            } catch (SocketTimeoutException | ConnectException | NoRouteToHostException e) {
                throw new ConnectFailed(e);
            }
            if (body != null) {
                OutputStream out = conn.getOutputStream();
                out.write(body);
                out.close();
            }
            int status = conn.getResponseCode();
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            byte[] data = in == null ? new byte[0] : Plugins.readAll(in);

            JSONObject h = new JSONObject();
            for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                if (e.getKey() != null) h.put(e.getKey().toLowerCase(), joinHeader(e.getValue()));
            }
            res.put("status", status);
            res.put("url", url.toString());
            res.put("headers", h);
            if ("base64".equals(req.optString("responseType"))) {
                res.put("bodyBase64", Base64.encodeToString(data, Base64.NO_WRAP));
            } else {
                res.put("body", new String(data, "UTF-8"));
            }
        } finally {
            conn.disconnect();
        }
    }

    /** Open a connection; with ipv4=true connect to the host's IPv4 address but keep TLS/SNI/Host on the name. */
    static HttpURLConnection open(URL url, boolean ipv4) throws Exception {
        if (!ipv4) {
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            if (conn instanceof HttpsURLConnection) ((HttpsURLConnection) conn).setSSLSocketFactory(tls());
            return conn;
        }
        final String host = url.getHost();
        InetAddress v4 = null;
        for (InetAddress a : InetAddress.getAllByName(host)) {
            if (a instanceof Inet4Address) {
                v4 = a;
                break;
            }
        }
        if (v4 == null) return open(url, false);
        URL direct = new URL(url.getProtocol(), v4.getHostAddress(), url.getPort(), url.getFile());
        HttpURLConnection conn = (HttpURLConnection) direct.openConnection();
        conn.setRequestProperty("Host", url.getPort() == -1 ? host : host + ":" + url.getPort());
        if (conn instanceof HttpsURLConnection) {
            HttpsURLConnection https = (HttpsURLConnection) conn;
            https.setSSLSocketFactory(new SniFactory(tls(), host));
            final HostnameVerifier verifier = HttpsURLConnection.getDefaultHostnameVerifier();
            https.setHostnameVerifier(new HostnameVerifier() {
                @Override
                public boolean verify(String ignored, SSLSession session) {
                    return verifier.verify(host, session);
                }
            });
        }
        return conn;
    }

    /** Connecting failed before any byte of the request was sent. */
    private static final class ConnectFailed extends Exception {
        final Exception cause;

        ConnectFailed(Exception cause) {
            super(cause);
            this.cause = cause;
        }
    }

    private static String joinHeader(List<String> values) {
        StringBuilder sb = new StringBuilder();
        for (String v : values) {
            if (sb.length() > 0) sb.append(", ");
            sb.append(v);
        }
        return sb.toString();
    }

    /** TLS over an IP-addressed socket, with SNI set to the real host name. */
    private static final class SniFactory extends SSLSocketFactory {
        private final SSLSocketFactory base;
        private final String host;

        SniFactory(SSLSocketFactory base, String host) {
            this.base = base;
            this.host = host;
        }

        @Override
        public Socket createSocket(Socket s, String ignored, int port, boolean autoClose) throws IOException {
            Socket tls = base.createSocket(s, host, port, autoClose); // SNI = real host
            return tls instanceof javax.net.ssl.SSLSocket ? new SniSocket((javax.net.ssl.SSLSocket) tls) : tls;
        }

        @Override
        public String[] getDefaultCipherSuites() {
            return base.getDefaultCipherSuites();
        }

        @Override
        public String[] getSupportedCipherSuites() {
            return base.getSupportedCipherSuites();
        }

        @Override
        public Socket createSocket(String h, int port) throws IOException {
            return base.createSocket(h, port);
        }

        @Override
        public Socket createSocket(String h, int port, InetAddress local, int localPort) throws IOException {
            return base.createSocket(h, port, local, localPort);
        }

        @Override
        public Socket createSocket(InetAddress a, int port) throws IOException {
            return base.createSocket(a, port);
        }

        @Override
        public Socket createSocket(InetAddress a, int port, InetAddress local, int localPort) throws IOException {
            return base.createSocket(a, port, local, localPort);
        }
    }
}

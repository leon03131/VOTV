package app.votv.host;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.SocketAddress;
import java.net.SocketException;

import javax.net.ssl.HandshakeCompletedListener;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocket;

/**
 * A TLS socket connected to an IP address that keeps SNI on the real host name.
 *
 * Android's HttpURLConnection (OkHttp) re-applies the URL host after creating the socket:
 * setHostname(...) by reflection on older Android, setSSLParameters(...) with the server names
 * on Android 10+. For a URL with an IP address that wipes the SNI we set, and Google's servers
 * then present a default certificate ("Trust anchor for certification path not found").
 * The wrapper hides setHostname and keeps our server names in setSSLParameters.
 */
final class SniSocket extends SSLSocket {
    private final SSLSocket s;
    private final java.util.List<javax.net.ssl.SNIServerName> serverNames;

    SniSocket(SSLSocket s) {
        this.s = s;
        this.serverNames = s.getSSLParameters().getServerNames();
    }

    @Override public String[] getSupportedCipherSuites() { return s.getSupportedCipherSuites(); }
    @Override public String[] getEnabledCipherSuites() { return s.getEnabledCipherSuites(); }
    @Override public void setEnabledCipherSuites(String[] v) { s.setEnabledCipherSuites(v); }
    @Override public String[] getSupportedProtocols() { return s.getSupportedProtocols(); }
    @Override public String[] getEnabledProtocols() { return s.getEnabledProtocols(); }
    @Override public void setEnabledProtocols(String[] v) { s.setEnabledProtocols(v); }
    @Override public SSLSession getSession() { return s.getSession(); }
    @Override public SSLSession getHandshakeSession() { return s.getHandshakeSession(); }
    @Override public void addHandshakeCompletedListener(HandshakeCompletedListener l) { s.addHandshakeCompletedListener(l); }
    @Override public void removeHandshakeCompletedListener(HandshakeCompletedListener l) { s.removeHandshakeCompletedListener(l); }
    @Override public void startHandshake() throws IOException { s.startHandshake(); }
    @Override public void setUseClientMode(boolean v) { s.setUseClientMode(v); }
    @Override public boolean getUseClientMode() { return s.getUseClientMode(); }
    @Override public void setNeedClientAuth(boolean v) { s.setNeedClientAuth(v); }
    @Override public boolean getNeedClientAuth() { return s.getNeedClientAuth(); }
    @Override public void setWantClientAuth(boolean v) { s.setWantClientAuth(v); }
    @Override public boolean getWantClientAuth() { return s.getWantClientAuth(); }
    @Override public void setEnableSessionCreation(boolean v) { s.setEnableSessionCreation(v); }
    @Override public boolean getEnableSessionCreation() { return s.getEnableSessionCreation(); }
    @Override public SSLParameters getSSLParameters() { return s.getSSLParameters(); }
    @Override public void setSSLParameters(SSLParameters p) {
        if (serverNames != null && !serverNames.isEmpty()) p.setServerNames(serverNames);
        s.setSSLParameters(p);
    }

    @Override public InputStream getInputStream() throws IOException { return s.getInputStream(); }
    @Override public OutputStream getOutputStream() throws IOException { return s.getOutputStream(); }
    @Override public void connect(SocketAddress a) throws IOException { s.connect(a); }
    @Override public void connect(SocketAddress a, int timeout) throws IOException { s.connect(a, timeout); }
    @Override public void bind(SocketAddress a) throws IOException { s.bind(a); }
    @Override public synchronized void close() throws IOException { s.close(); }
    @Override public boolean isClosed() { return s.isClosed(); }
    @Override public boolean isConnected() { return s.isConnected(); }
    @Override public boolean isBound() { return s.isBound(); }
    @Override public boolean isInputShutdown() { return s.isInputShutdown(); }
    @Override public boolean isOutputShutdown() { return s.isOutputShutdown(); }
    @Override public void shutdownInput() throws IOException { s.shutdownInput(); }
    @Override public void shutdownOutput() throws IOException { s.shutdownOutput(); }
    @Override public InetAddress getInetAddress() { return s.getInetAddress(); }
    @Override public InetAddress getLocalAddress() { return s.getLocalAddress(); }
    @Override public int getPort() { return s.getPort(); }
    @Override public int getLocalPort() { return s.getLocalPort(); }
    @Override public SocketAddress getRemoteSocketAddress() { return s.getRemoteSocketAddress(); }
    @Override public SocketAddress getLocalSocketAddress() { return s.getLocalSocketAddress(); }
    @Override public synchronized void setSoTimeout(int t) throws SocketException { s.setSoTimeout(t); }
    @Override public synchronized int getSoTimeout() throws SocketException { return s.getSoTimeout(); }
    @Override public void setTcpNoDelay(boolean v) throws SocketException { s.setTcpNoDelay(v); }
    @Override public boolean getTcpNoDelay() throws SocketException { return s.getTcpNoDelay(); }
    @Override public void setKeepAlive(boolean v) throws SocketException { s.setKeepAlive(v); }
    @Override public boolean getKeepAlive() throws SocketException { return s.getKeepAlive(); }
    @Override public void setSoLinger(boolean on, int linger) throws SocketException { s.setSoLinger(on, linger); }
    @Override public int getSoLinger() throws SocketException { return s.getSoLinger(); }
    @Override public synchronized void setReceiveBufferSize(int v) throws SocketException { s.setReceiveBufferSize(v); }
    @Override public synchronized int getReceiveBufferSize() throws SocketException { return s.getReceiveBufferSize(); }
    @Override public synchronized void setSendBufferSize(int v) throws SocketException { s.setSendBufferSize(v); }
    @Override public synchronized int getSendBufferSize() throws SocketException { return s.getSendBufferSize(); }
    @Override public String toString() { return "SniSocket[" + s + "]"; }
}

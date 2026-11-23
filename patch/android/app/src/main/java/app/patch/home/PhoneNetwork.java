package app.patch.home;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.RouteInfo;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;

/**
 * The phone's Wi-Fi network: its address, the router and the DNS servers. Android doesn't let ordinary
 * programs see these, so the app reads them and keeps network.json up to date for Patch's server.
 */
final class PhoneNetwork {
    private static final String TAG = "Patch";
    private static boolean watching;

    static final class Info {
        String wifi = "";      // "192.168.1.23/24", or "" when the phone isn't on Wi-Fi
        String gateway = "";   // "192.168.1.1"
        String dns = "";       // "192.168.1.1,8.8.8.8"
    }

    private PhoneNetwork() {}

    /** The Wi-Fi (or wired) network the phone is on now, leaving out one that's just gone. */
    @SuppressWarnings("deprecation") // getAllNetworks() still works and covers every Android version Patch supports
    static Info read(Context context, Network leaving) {
        Info info = new Info();
        ConnectivityManager cm = context.getSystemService(ConnectivityManager.class);
        if (cm == null) return info;
        for (Network n : cm.getAllNetworks()) {
            if (n.equals(leaving)) continue;
            NetworkCapabilities caps = cm.getNetworkCapabilities(n);
            if (caps == null) continue;
            if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) continue;
            LinkProperties lp = cm.getLinkProperties(n);
            if (lp == null) continue;
            for (LinkAddress la : lp.getLinkAddresses()) {
                InetAddress a = la.getAddress();
                if (a instanceof Inet4Address && !a.isLoopbackAddress() && !a.isLinkLocalAddress()) {
                    info.wifi = a.getHostAddress() + "/" + la.getPrefixLength();
                    break;
                }
            }
            if (info.wifi.isEmpty()) continue;
            for (RouteInfo r : lp.getRoutes()) {
                InetAddress g = r.getGateway();
                if (r.isDefaultRoute() && g instanceof Inet4Address && !g.isAnyLocalAddress()) {
                    info.gateway = g.getHostAddress();
                    break;
                }
            }
            StringBuilder dns = new StringBuilder();
            for (InetAddress d : lp.getDnsServers()) {
                if (!(d instanceof Inet4Address)) continue;
                if (dns.length() > 0) dns.append(',');
                dns.append(d.getHostAddress());
            }
            info.dns = dns.toString();
            break;
        }
        return info;
    }

    /** Writes network.json for Patch's server (all at once, so it never reads half a file). */
    static Info write(Context context, File file) {
        return write(context, file, null);
    }

    private static synchronized Info write(Context context, File file, Network leaving) {
        Info info = read(context, leaving);
        String json = "{\"wifi\":\"" + safe(info.wifi) + "\",\"gateway\":\"" + safe(info.gateway) + "\",\"dns\":\"" + safe(info.dns) + "\"}";
        File tmp = new File(file.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (IOException e) {
            Log.w(TAG, "Couldn't save the network details", e);
            return info;
        }
        if (!tmp.renameTo(file)) Log.w(TAG, "Couldn't save the network details");
        return info;
    }

    /** Keeps network.json current when the phone joins, leaves or changes Wi-Fi. */
    static synchronized void watch(Context context, File file) {
        if (watching) return;
        ConnectivityManager cm = context.getSystemService(ConnectivityManager.class);
        if (cm == null) return;
        NetworkRequest request = new NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
            .build();
        try {
            cm.registerNetworkCallback(request, new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    write(context, file, null);
                }

                @Override
                public void onLinkPropertiesChanged(Network network, LinkProperties lp) {
                    write(context, file, null);
                }

                @Override
                public void onLost(Network network) {
                    write(context, file, network);
                }
            });
            watching = true;
        } catch (RuntimeException e) {
            Log.w(TAG, "Can't follow network changes", e);
        }
    }

    /** Only the characters an address list can contain. */
    private static String safe(String s) {
        return s == null ? "" : s.replaceAll("[^0-9./,]", "");
    }
}

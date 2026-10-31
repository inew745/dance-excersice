package com.danceexercise.chartmaker;

import android.app.Activity;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;

import android.util.Base64;

/**
 * Hosts the bundled single-page app in a WebView and exposes a small native
 * HTTP bridge. The bridge is why YouTube can work here at all: requests run in
 * Java on the phone's own connection, so there is no CORS and the IP is
 * residential rather than a datacenter range YouTube bot-checks.
 */
public class MainActivity extends Activity {

    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // The page is served from file:///android_asset; let its own scripts run.
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);

        // Surface WebCodecs/console problems during the blind first run.
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "AndroidNative");

        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private class Bridge {

        /**
         * Performs an HTTP request natively and returns a JSON string:
         * {"status":int,"headers":{..},"body":"<base64 of response bytes>"}.
         * Runs on the JavaScriptInterface thread, not the UI thread, so the
         * network call here is allowed. Synchronous by design — the page shows
         * a progress line before calling.
         */
        @JavascriptInterface
        public String http(String urlStr, String method, String headersJson, String body) {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(urlStr);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod(method);
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(60000);
                conn.setInstanceFollowRedirects(true);

                if (headersJson != null && headersJson.length() > 2) {
                    JSONObject h = new JSONObject(headersJson);
                    Iterator<String> keys = h.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        conn.setRequestProperty(k, h.getString(k));
                    }
                }

                if ("POST".equalsIgnoreCase(method) && body != null && body.length() > 0) {
                    conn.setDoOutput(true);
                    byte[] out = body.getBytes("UTF-8");
                    conn.setFixedLengthStreamingMode(out.length);
                    OutputStream os = conn.getOutputStream();
                    os.write(out);
                    os.close();
                }

                int status = conn.getResponseCode();
                InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                byte[] bytes = readAll(in);

                JSONObject res = new JSONObject();
                res.put("status", status);
                res.put("body", Base64.encodeToString(bytes, Base64.NO_WRAP));
                JSONObject outHeaders = new JSONObject();
                if (conn.getContentType() != null) outHeaders.put("content-type", conn.getContentType());
                res.put("headers", outHeaders);
                return res.toString();
            } catch (Exception e) {
                try {
                    JSONObject err = new JSONObject();
                    err.put("status", 0);
                    err.put("error", String.valueOf(e.getMessage()));
                    err.put("body", "");
                    return err.toString();
                } catch (Exception ignored) {
                    return "{\"status\":0,\"body\":\"\"}";
                }
            } finally {
                if (conn != null) conn.disconnect();
            }
        }

        /**
         * Writes a rendered video to the app's external Movies directory, which
         * needs no storage permission on any Android version, and returns the
         * path for display.
         */
        @JavascriptInterface
        public String saveVideo(String name, String dataB64) {
            try {
                byte[] data = Base64.decode(dataB64, Base64.DEFAULT);
                File dir = getExternalFilesDir(Environment.DIRECTORY_MOVIES);
                if (dir != null && !dir.exists()) dir.mkdirs();
                File out = new File(dir, name);
                FileOutputStream fos = new FileOutputStream(out);
                fos.write(data);
                fos.close();
                final String path = out.getAbsolutePath();
                runOnUiThread(new Runnable() {
                    public void run() {
                        Toast.makeText(MainActivity.this, "Saved to " + path, Toast.LENGTH_LONG).show();
                    }
                });
                return path;
            } catch (Exception e) {
                return "ERROR: " + e.getMessage();
            }
        }

        private byte[] readAll(InputStream in) throws Exception {
            if (in == null) return new byte[0];
            BufferedInputStream bis = new BufferedInputStream(in);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = bis.read(buf)) != -1) bos.write(buf, 0, n);
            bis.close();
            return bos.toByteArray();
        }
    }
}

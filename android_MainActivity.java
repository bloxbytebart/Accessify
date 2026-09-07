package com.accessify.app;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int MIC_PERMISSION_REQUEST_CODE = 1;
    private static final int FILE_CHOOSER_REQUEST_CODE = 2;

    private ValueCallback<Uri[]> filePathCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Enable remote debugging via chrome://inspect / edge://inspect.
        // (Hardcoded true rather than BuildConfig.DEBUG, since newer
        // Android Gradle Plugin versions don't auto-generate BuildConfig
        // unless explicitly enabled in build.gradle - true is fine here
        // since this is a testing/debug build; if you ever ship a real
        // release build later, flip this back off.)
        WebView.setWebContentsDebuggingEnabled(true);

        // Ask Android itself for microphone access (the OS-level runtime
        // permission prompt, separate from the browser-level one).
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.RECORD_AUDIO},
                    MIC_PERMISSION_REQUEST_CODE
            );
        }

        // Replacing the WebChromeClient entirely (instead of only adding
        // to Capacitor's default one) means we have to re-implement
        // everything the default one normally handles for us - not just
        // the mic permission, but also <input type="file"> pickers (used
        // by both the Image and Document content types), via
        // onShowFileChooser below. Without this override, tapping "Choose
        // a photo"/"Choose a PDF" does nothing at all, since nothing
        // launches Android's actual file-picker screen.
        this.bridge.getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }

            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams fileChooserParams) {
                filePathCallback = callback;
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE);
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (filePathCallback == null) return;
            filePathCallback.onReceiveValue(
                    WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            filePathCallback = null;
        }
    }
}

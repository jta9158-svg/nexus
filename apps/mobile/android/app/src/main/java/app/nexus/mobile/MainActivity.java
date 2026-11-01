package app.nexus.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin que mantém a call viva em segundo plano.
        registerPlugin(CallKeepAlivePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

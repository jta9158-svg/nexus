package app.nexus.mobile;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin que mantém a call viva em segundo plano.
        registerPlugin(CallKeepAlivePlugin.class);
        super.onCreate(savedInstanceState);

        // O "motor" da página (onde roda a call, o microfone e o anti-ruído) segue
        // com prioridade alta mesmo com o app atrás ou com a tela apagada; assim o
        // Android não congela nem fecha a call enquanto você usa outro app.
        Bridge bridge = getBridge();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && bridge != null) {
            WebView webView = bridge.getWebView();
            if (webView != null) {
                webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
            }
        }
    }
}

package app.nexus.mobile;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Ponte entre o app web e o serviço que segura a call em segundo plano.
 * JS: CallKeepAlive.start({ mic, title, text }) ao entrar na call;
 *     CallKeepAlive.stop() ao sair.
 */
@CapacitorPlugin(
    name = "CallKeepAlive",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class CallKeepAlivePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        // Pede a permissão de notificação (Android 13+) na primeira call, para a
        // pessoa ver a notificação "Em uma call". O serviço roda mesmo se negar.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            && getPermissionState("notifications") != com.getcapacitor.PermissionState.DENIED) {
            requestPermissionForAlias("notifications", call, "afterNotifications");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void afterNotifications(PluginCall call) {
        startService(call);
    }

    private void startService(PluginCall call) {
        boolean mic = call.getBoolean("mic", true);
        String title = call.getString("title", "Em uma call no NEXUS");
        String text = call.getString("text", "Toque para voltar à call");
        Intent intent = new Intent(getContext(), CallService.class);
        intent.setAction(CallService.ACTION_START);
        intent.putExtra("mic", mic);
        intent.putExtra("title", title);
        intent.putExtra("text", text);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            call.resolve();
        } catch (Exception e) {
            // Se o sistema recusar, a call segue funcionando com o app aberto.
            call.resolve();
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), CallService.class);
        intent.setAction(CallService.ACTION_STOP);
        try {
            getContext().startService(intent);
        } catch (Exception ignored) {
        }
        call.resolve();
    }
}

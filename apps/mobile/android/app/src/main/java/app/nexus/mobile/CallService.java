package app.nexus.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

/**
 * Serviço em primeiro plano que mantém a call viva quando o NEXUS vai para
 * segundo plano (a pessoa abre outro app). Enquanto ele roda, o Android não
 * suspende nem fecha o app, então o áudio continua. Mostra uma notificação fixa
 * "Em uma call" que, ao tocar, volta para o app.
 */
public class CallService extends Service {
    public static final String ACTION_START = "app.nexus.mobile.CALL_START";
    public static final String ACTION_STOP = "app.nexus.mobile.CALL_STOP";
    private static final String CHANNEL_ID = "nexus_call";
    private static final int NOTIF_ID = 4711;
    // Até 6 h de call; depois disso o próprio áudio ativo continua segurando o aparelho.
    private static final long WAKE_LOCK_MAX_MS = 6L * 60 * 60 * 1000;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        final String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            releaseLocks();
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }

        final boolean mic = intent == null || intent.getBooleanExtra("mic", true);
        final String title = textOr(intent, "title", "Em uma call no NEXUS");
        final String text = textOr(intent, "text", "Toque para voltar à call");

        createChannel();
        final Notification notification = buildNotification(title, text);

        // Android 10+ exige declarar o tipo do serviço. Microfone para quem fala;
        // mídia para quem só ouve (evita erro quando não há permissão de microfone).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            int type = mic
                ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                : ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
            try {
                startForeground(NOTIF_ID, notification, type);
            } catch (Exception e) {
                // Microfone sem permissão concedida pode lançar exceção: cai para mídia.
                try {
                    startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } catch (Exception e2) {
                    stopSelf();
                    return START_NOT_STICKY;
                }
            }
        } else {
            try {
                startForeground(NOTIF_ID, notification);
            } catch (Exception e) {
                stopSelf();
                return START_NOT_STICKY;
            }
        }
        acquireLocks();
        return START_STICKY;
    }

    /**
     * Com a tela apagada, segura o processador e o Wi-Fi em modo de baixa latência
     * enquanto a call durar (como os apps de chamada), para a voz não picotar nem cair.
     */
    private void acquireLocks() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NEXUS::Call");
                    wakeLock.setReferenceCounted(false);
                    wakeLock.acquire(WAKE_LOCK_MAX_MS);
                }
            }
        } catch (Exception ignored) {
        }
        try {
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                        : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                    wifiLock = wm.createWifiLock(mode, "NEXUS::Call");
                    wifiLock.setReferenceCounted(false);
                    wifiLock.acquire();
                }
            }
        } catch (Exception ignored) {
        }
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
        }
        wakeLock = null;
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Exception ignored) {
        }
        wifiLock = null;
    }

    @Override
    public void onDestroy() {
        releaseLocks();
        super.onDestroy();
    }

    private Notification buildNotification(String title, String text) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, open, piFlags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_call_notification)
            .setOngoing(true)
            .setContentIntent(contentIntent)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setShowWhen(false)
            .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Calls", NotificationManager.IMPORTANCE_LOW);
                channel.setDescription("Mantém a call ativa quando o NEXUS está em segundo plano");
                channel.setShowBadge(false);
                channel.setSound(null, null);
                nm.createNotificationChannel(channel);
            }
        }
    }

    private void stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
    }

    private static String textOr(Intent intent, String key, String fallback) {
        if (intent == null) return fallback;
        String v = intent.getStringExtra(key);
        return (v == null || v.isEmpty()) ? fallback : v;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Se a pessoa fecha o app pela lista de recentes, encerra a call também.
        releaseLocks();
        stopForegroundCompat();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

package expo.modules.callservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps a voice call's microphone working while the app is in the background or
 * the screen is locked. Android only lets a background app use the microphone
 * from a foreground service of type "microphone", and that service has to show an
 * ongoing notification for as long as it runs.
 */
class CallForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, startFlags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "On a call"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Voice calls", NotificationManager.IMPORTANCE_LOW)
      )
    }

    // Tapping the notification brings the call back to the front.
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    launch?.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val contentIntent = launch?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val notification = builder
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setContentIntent(contentIntent)
      .build()

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      // Android refuses a microphone service without the RECORD_AUDIO grant, or
      // when asked from the background. The call still works while the app is
      // open, so stop quietly instead of crashing the call.
      stopSelf()
    }
    return START_NOT_STICKY
  }

  // Swiping the app away ends the call, so the notification must go with it.
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopSelf()
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    private const val CHANNEL_ID = "evarna_voice_call"
    private const val NOTIFICATION_ID = 7301
  }
}

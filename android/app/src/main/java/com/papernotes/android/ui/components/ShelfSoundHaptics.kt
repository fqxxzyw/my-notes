package com.papernotes.android.ui.components

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.HapticFeedbackConstants
import android.view.View
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sin
import kotlin.random.Random

/**
 * Offline synthesized paper-spine sliding audio + subtle tactile micro-vibration feedback
 * for Paper Notes Android bookshelves and miniature cabinet previews.
 */
object ShelfSoundHaptics {
    private const val PREFS_NAME = "paper_notes_feedback_prefs"
    private const val KEY_SOUND = "shelf_sound_enabled"
    private const val KEY_HAPTIC = "shelf_haptic_enabled"
    private const val SAMPLE_RATE = 44100

    private val _soundEnabled = MutableStateFlow(true)
    val soundEnabled: StateFlow<Boolean> = _soundEnabled.asStateFlow()

    private val _hapticEnabled = MutableStateFlow(true)
    val hapticEnabled: StateFlow<Boolean> = _hapticEnabled.asStateFlow()

    @Volatile
    private var initialized = false
    @Volatile
    private var lastTickMs = 0L
    @Volatile
    private var lastMiniTickMs = 0L
    @Volatile
    private var lastBumpMs = 0L

    private val audioExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "PaperShelfAudio").apply { isDaemon = true }
    }

    private val shelfTickPcm: ShortArray by lazy {
        synthesizePaperTick(durationMs = 24, startFreq = 415.0, endFreq = 168.0, toneAmp = 0.24, noiseAmp = 0.14)
    }
    private val miniTickPcm: ShortArray by lazy {
        synthesizePaperTick(durationMs = 17, startFreq = 540.0, endFreq = 250.0, toneAmp = 0.17, noiseAmp = 0.10)
    }
    private val edgeBumpPcm: ShortArray by lazy {
        synthesizePaperTick(durationMs = 30, startFreq = 152.0, endFreq = 76.0, toneAmp = 0.22, noiseAmp = 0.05)
    }

    fun init(context: Context) {
        if (initialized) return
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        _soundEnabled.value = prefs.getBoolean(KEY_SOUND, true)
        _hapticEnabled.value = prefs.getBoolean(KEY_HAPTIC, true)
        initialized = true
    }

    fun setSoundEnabled(context: Context, enabled: Boolean) {
        init(context)
        _soundEnabled.value = enabled
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_SOUND, enabled).apply()
    }

    fun setHapticEnabled(context: Context, enabled: Boolean) {
        init(context)
        _hapticEnabled.value = enabled
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_HAPTIC, enabled).apply()
    }

    fun toggleSound(context: Context, view: View? = null) {
        val next = !_soundEnabled.value
        setSoundEnabled(context, next)
        if (next) playShelfTick(context, view)
    }

    fun playShelfTick(context: Context, view: View? = null) {
        init(context)
        val now = SystemClock.elapsedRealtime()
        if (now - lastTickMs < 46L) return
        lastTickMs = now
        if (_soundEnabled.value) playPcmAsync(shelfTickPcm)
        if (_hapticEnabled.value) triggerMicroTick(context, view, strong = false)
    }

    fun playMiniTick(context: Context, view: View? = null) {
        init(context)
        val now = SystemClock.elapsedRealtime()
        if (now - lastMiniTickMs < 56L) return
        lastMiniTickMs = now
        if (_soundEnabled.value) playPcmAsync(miniTickPcm)
        if (_hapticEnabled.value) triggerMicroTick(context, view, strong = false)
    }

    fun playEdgeBump(context: Context, view: View? = null) {
        init(context)
        val now = SystemClock.elapsedRealtime()
        if (now - lastBumpMs < 260L) return
        lastBumpMs = now
        if (_soundEnabled.value) playPcmAsync(edgeBumpPcm)
        if (_hapticEnabled.value) triggerMicroTick(context, view, strong = true)
    }

    private fun triggerMicroTick(context: Context, view: View?, strong: Boolean) {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vm?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
            if (vibrator != null && vibrator.hasVibrator()) {
                val effect = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    VibrationEffect.createPredefined(
                        if (strong) VibrationEffect.EFFECT_CLICK else VibrationEffect.EFFECT_TICK
                    )
                } else {
                    VibrationEffect.createOneShot(if (strong) 14L else 9L, if (strong) 72 else 44)
                }
                vibrator.vibrate(effect)
                return
            }
        } catch (_: Throwable) {
            // Fall through to View haptic feedback
        }
        try {
            view?.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
        } catch (_: Throwable) { /* ignore */ }
    }

    private fun playPcmAsync(samples: ShortArray) {
        audioExecutor.execute {
            var track: AudioTrack? = null
            try {
                val byteLen = samples.size * 2
                val attrs = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
                val format = AudioFormat.Builder()
                    .setSampleRate(SAMPLE_RATE)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
                track = AudioTrack.Builder()
                    .setAudioAttributes(attrs)
                    .setAudioFormat(format)
                    .setBufferSizeInBytes(byteLen)
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .build()
                track.write(samples, 0, samples.size)
                track.play()
                // Wait briefly for the tiny ~25ms buffer to finish before releasing cleanly.
                Thread.sleep((samples.size * 1000L / SAMPLE_RATE) + 18L)
            } catch (_: Throwable) {
                // Gracefully degrade on emulators / muted audio hardware.
            } finally {
                try { track?.stop() } catch (_: Throwable) {}
                try { track?.release() } catch (_: Throwable) {}
            }
        }
    }

    /** Synthesize a crisp wooden-spine tap + paper-edge fiber whisper into 16-bit PCM. */
    private fun synthesizePaperTick(
        durationMs: Int,
        startFreq: Double,
        endFreq: Double,
        toneAmp: Double,
        noiseAmp: Double
    ): ShortArray {
        val total = (SAMPLE_RATE * durationMs) / 1000
        val out = ShortArray(total)
        val rng = Random(42 + durationMs)
        var phase = 0.0
        var prevNoise = 0.0
        for (i in 0 until total) {
            val t = i.toDouble() / total
            val freq = startFreq * (endFreq / startFreq).pow(t)
            phase += 2.0 * PI * freq / SAMPLE_RATE
            val attack = (i / (SAMPLE_RATE * 0.0022)).coerceAtMost(1.0)
            val decay = exp(-5.2 * t)
            // Triangle-ish warm body
            val tri = (2.0 / PI) * kotlin.math.asin(sin(phase))
            // High-passed crisp paper edge rustle
            val white = rng.nextDouble(-1.0, 1.0)
            val hpNoise = white - 0.72 * prevNoise
            prevNoise = white
            val noiseEnv = exp(-7.5 * t)
            val mixed = (tri * toneAmp * attack * decay) + (hpNoise * noiseAmp * noiseEnv)
            out[i] = (mixed.coerceIn(-0.95, 0.95) * Short.MAX_VALUE).toInt().toShort()
        }
        return out
    }
}

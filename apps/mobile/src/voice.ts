import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";

/** What a finished recording hands back. */
export interface RecordedVoice {
  uri: string;
  durationMs: number;
}

/**
 * The recording engine, separated from anything that draws it.
 *
 * It used to live inside `VoiceRecorder`, which started recording when it
 * mounted. That is the right shape for a panel you open — and the wrong one for
 * hold-to-record, where the microphone has to be live from the moment the thumb
 * lands, long before anything has decided which panel to show. So the engine
 * moved here, and both the press-and-hold button and the hands-free panel drive
 * the same one.
 *
 * Shorter than half a second is a fumbled tap, not a voice note, and
 * `stop()` reports that as a discard rather than sending a message that is
 * nothing but a click.
 */
export const MIN_MS = 500;

/**
 * The running clock, read from the recorder only while it is running.
 *
 * expo-audio ships `useAudioRecorderState` for this and it is the wrong tool
 * here, for a reason that only appeared when the engine moved. That hook starts
 * a `setInterval` on mount and never stops it, and its effect depends on the
 * recorder's id alone — so the interval it opens polls `getStatus()` forever, at
 * whatever rate it was first given, whether or not anything is being recorded.
 *
 * While the recorder lived inside the panel you tapped open, that was harmless:
 * the hook mounted with the recording and unmounted with it, so it polled for
 * exactly as long as there was something to report. Hoisting the engine up to
 * the composer so a *held* button could drive it moved that interval up with it,
 * and it has been calling into the native recorder four times a second for the
 * whole life of every open conversation ever since, to report that nothing is
 * happening.
 *
 * That is worth undoing on its own — but the sharper point is what it does to
 * the start of a recording. `getStatus()` is a synchronous call on the JS
 * thread; `prepareToRecordAsync` runs `MediaRecorder.prepare()` on a coroutine.
 * A free-running interval means those two can land on the same non-thread-safe
 * `MediaRecorder` at once, which the old arrangement made almost impossible —
 * its first tick came 250ms after the same mount that began preparing, by which
 * point preparing was long done.
 *
 * So: poll while live, and not otherwise. Nothing reads a recorder that isn't
 * running, and there is no interval open when one is being prepared.
 */
function useRecorderClock(recorder: ReturnType<typeof useAudioRecorder>, live: boolean) {
  const [status, setStatus] = useState({ durationMillis: 0, isRecording: false });

  useEffect(() => {
    if (!live) {
      // Back to zero for the next take, rather than leaving the last one's
      // final duration on the clock.
      setStatus({ durationMillis: 0, isRecording: false });
      return;
    }
    const read = () => {
      const s = recorder.getStatus();
      setStatus((prev) =>
        // Same guard the upstream hook uses: a poll that says nothing changed
        // must not re-render the composer four times a second.
        prev.isRecording === s.isRecording &&
        Math.abs(prev.durationMillis - s.durationMillis) <= 50
          ? prev
          : { durationMillis: s.durationMillis, isRecording: s.isRecording },
      );
    };
    read();
    const id = setInterval(read, 250);
    return () => clearInterval(id);
  }, [recorder, live]);

  return status;
}

export function useVoiceRecording() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [live, setLive] = useState(false);
  const state = useRecorderClock(recorder, live);
  const [failed, setFailed] = useState<string | null>(null);
  /** Set the instant `start()` is called, before the async permission and
   *  prepare steps finish — so a release that beats them cancels cleanly
   *  instead of leaving a recorder running with nothing watching it. */
  const wanted = useRef(false);
  /**
   * Whether the native recorder is actually running.
   *
   * Distinct from `wanted`, and the distinction is the whole bug. `wanted` means
   * "the thumb is down"; this means "`record()` returned". Between the two sits
   * the permission prompt, which on the first ever press is a system dialog that
   * takes the foreground — so the gesture ends, `stop()` runs, and it used to
   * call `recorder.stop()` on a recorder that had never been prepared.
   *
   * On Android that is `MediaRecorder.stop()` in an invalid state, which throws
   * `IllegalStateException` from inside the module's own coroutine. A `try`
   * around the JS call does not catch that: it is a native crash, and the app
   * goes away rather than showing an error. Hence a second flag, and nothing
   * touching the recorder unless it is set.
   */
  const started = useRef(false);

  // `recorder.currentTime` is only meaningful once something is running; read it
  // for a recorder that was never prepared and the number is meaningless at
  // best. The poller's `durationMillis` is the real source, this is the
  // fallback between `record()` and the first poll — and it is gated on `live`
  // rather than on `started`, so nothing reaches into the recorder during a
  // render that happens while it is being prepared.
  const seconds = state.durationMillis
    ? state.durationMillis / 1000
    : live
      ? (recorder.currentTime ?? 0)
      : 0;

  /** Put the audio session back. Skipping this leaves playback in record mode:
   *  on iOS the next voice note comes out of the earpiece at a whisper. */
  const release = useCallback(async () => {
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  }, []);

  const start = useCallback(async () => {
    if (wanted.current) return;
    wanted.current = true;
    setFailed(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        wanted.current = false;
        Alert.alert("Microphone access needed", "Allow microphone access to record a voice note.");
        return;
      }
      // Recording without `allowsRecording` produces a silent file on iOS
      // rather than an error, which is the kind of bug you only find after
      // shipping.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      // Released mid-await: don't start a recording nobody is holding.
      if (!wanted.current) return void (await release());
      await recorder.prepareToRecordAsync();
      if (!wanted.current) return void (await release());
      recorder.record();
      started.current = true;
      setLive(true);
    } catch (err) {
      wanted.current = false;
      started.current = false;
      setLive(false);
      setFailed(err instanceof Error ? err.message : "Couldn't start recording");
      await release();
    }
  }, [recorder, release]);

  /** Finish and hand back the file, or null if there isn't a usable one. */
  const stop = useCallback(async (): Promise<RecordedVoice | null> => {
    if (!wanted.current) return null;
    wanted.current = false;
    setLive(false);
    // Let go before the permission prompt was answered, or before `prepare`
    // finished: there is no recording, and asking the native recorder to stop
    // one is the crash described on `started`. Put the session back and say
    // nothing — the agent lifted their thumb, which is not an error.
    if (!started.current) {
      await release();
      return null;
    }
    started.current = false;
    try {
      const ms = Math.round(seconds * 1000);
      await recorder.stop();
      // Read the file's location *before* touching the audio session. Tearing
      // down recording mode is what releases the recorder, and a released
      // recorder has no uri to give — which would look exactly like "the
      // recording came back empty" while the file sat on disk perfectly fine.
      const uri = recorder.uri;
      await release();
      if (!uri) {
        setFailed("The recording came back empty");
        return null;
      }
      if (ms < MIN_MS) return null;
      return { uri, durationMs: ms };
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Couldn't save the recording");
      return null;
    }
  }, [recorder, release, seconds]);

  /** Throw it away. Nothing to report on failure — it's going in the bin. */
  const cancel = useCallback(async () => {
    if (!wanted.current) return;
    wanted.current = false;
    setLive(false);
    // Same guard as `stop` — see `started`. Nothing to throw away, and asking
    // anyway is what took the app down.
    if (!started.current) {
      await release();
      return;
    }
    started.current = false;
    try {
      await recorder.stop();
    } catch {
      /* already stopped by the OS (a call arriving, the app backgrounding) */
    }
    await release();
  }, [recorder, release]);

  // Guarded for the same reason as `stop`. The locked panel's buttons are only
  // reachable after a successful hold — but "only reachable after" is exactly
  // what was assumed about `stop()`, and a slide-up that locks while the
  // permission prompt is still open gets there with nothing running.
  const pause = useCallback(() => {
    if (started.current) recorder.pause();
  }, [recorder]);
  const resume = useCallback(() => {
    if (started.current) recorder.record();
  }, [recorder]);

  // A screen torn down mid-recording must not leave the microphone open and the
  // session in record mode for whatever comes next.
  useEffect(
    () => () => {
      wanted.current = false;
      // Only a recorder that actually started may be stopped; see `started`.
      // A screen torn down while the permission prompt is still up has nothing
      // running, and stopping it would crash on the way out of the screen.
      if (started.current) {
        started.current = false;
        try {
          recorder.stop();
        } catch {
          /* nothing to do while unmounting */
        }
      }
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    },
    [recorder],
  );

  return {
    /** True from the moment recording actually begins. */
    live,
    /** True while the recorder is running rather than paused. */
    isRecording: state.isRecording,
    seconds,
    failed,
    clearFailure: () => setFailed(null),
    start,
    stop,
    cancel,
    pause,
    resume,
  };
}

export type VoiceRecording = ReturnType<typeof useVoiceRecording>;

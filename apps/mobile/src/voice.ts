import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { endTrail, mark } from "./diagnostics";

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

export function useVoiceRecording() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [live, setLive] = useState(false);
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
  // fallback between `record()` and the first poll.
  const seconds = state.durationMillis
    ? state.durationMillis / 1000
    : started.current
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
      // Each `mark` is on disk before the call under it runs; see `diagnostics`.
      // Four native calls, four names — whichever one takes the process down,
      // its name is the last thing in the trail.
      await mark("perm");
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        wanted.current = false;
        await endTrail();
        Alert.alert("Microphone access needed", "Allow microphone access to record a voice note.");
        return;
      }
      // Recording without `allowsRecording` produces a silent file on iOS
      // rather than an error, which is the kind of bug you only find after
      // shipping.
      await mark("mode");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      // Released mid-await: don't start a recording nobody is holding.
      if (!wanted.current) return void (await release());
      await mark("prepare");
      await recorder.prepareToRecordAsync();
      if (!wanted.current) return void (await release());
      await mark("record");
      recorder.record();
      started.current = true;
      setLive(true);
      await mark("live");
    } catch (err) {
      wanted.current = false;
      started.current = false;
      setLive(false);
      setFailed(err instanceof Error ? err.message : "Couldn't start recording");
      // A JS error is not what the trail is hunting — it already reached the
      // catch, so the app is alive and the message is on screen. Keep it in the
      // trail rather than clearing it, so a caught failure reads differently
      // from a clean run.
      await mark(`threw: ${err instanceof Error ? err.message : "unknown"}`);
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
      await endTrail();
      return null;
    }
    started.current = false;
    try {
      const ms = Math.round(seconds * 1000);
      await mark("stop");
      await recorder.stop();
      // Read the file's location *before* touching the audio session. Tearing
      // down recording mode is what releases the recorder, and a released
      // recorder has no uri to give — which would look exactly like "the
      // recording came back empty" while the file sat on disk perfectly fine.
      const uri = recorder.uri;
      // Putting the audio session back is a native call like any other, so it
      // stays inside the trail. Only once it returns is the sequence over.
      await mark("release");
      await release();
      await endTrail();
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
      await endTrail();
      return;
    }
    started.current = false;
    try {
      await mark("cancel-stop");
      await recorder.stop();
    } catch {
      /* already stopped by the OS (a call arriving, the app backgrounding) */
    }
    await mark("cancel-release");
    await release();
    await endTrail();
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

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
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

export function useVoiceRecording() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** Set the instant `start()` is called, before the async permission and
   *  prepare steps finish — so a release that beats them cancels cleanly
   *  instead of leaving a recorder running with nothing watching it. */
  const wanted = useRef(false);

  const seconds = state.durationMillis ? state.durationMillis / 1000 : (recorder.currentTime ?? 0);

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
      setLive(true);
    } catch (err) {
      wanted.current = false;
      setLive(false);
      setFailed(err instanceof Error ? err.message : "Couldn't start recording");
    }
  }, [recorder, release]);

  /** Finish and hand back the file, or null if there isn't a usable one. */
  const stop = useCallback(async (): Promise<RecordedVoice | null> => {
    if (!wanted.current) return null;
    wanted.current = false;
    setLive(false);
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
    try {
      await recorder.stop();
    } catch {
      /* already stopped, or never started */
    }
    await release();
  }, [recorder, release]);

  const pause = useCallback(() => recorder.pause(), [recorder]);
  const resume = useCallback(() => recorder.record(), [recorder]);

  // A screen torn down mid-recording must not leave the microphone open and the
  // session in record mode for whatever comes next.
  useEffect(
    () => () => {
      if (wanted.current) {
        wanted.current = false;
        try {
          recorder.stop();
        } catch {
          /* nothing to do while unmounting */
        }
        void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      }
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

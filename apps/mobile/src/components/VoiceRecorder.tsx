import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { formatDuration } from "@ding/client";
import { PauseIcon, SendIcon, TrashIcon } from "../icons";
import { useTheme } from "../theme";
import { Touchable } from "./Touchable";

/** What the recorder hands back once you send it. */
export interface RecordedVoice {
  uri: string;
  durationMs: number;
}

/**
 * A voice note, recorded in place of the composer.
 *
 * It replaces the input row rather than floating over it, because while you're
 * recording there is nothing else to do — the row's three states (delete, the
 * running clock, send) are the whole interaction. That's WhatsApp's arrangement
 * and it's the right one: the destructive action sits furthest from the send
 * button, so a thumb reaching for one can't hit the other.
 *
 * Pause exists because a voice note is often interrupted, and losing thirty
 * seconds of explanation to a passing lorry is worse than an extra control.
 */
export function VoiceRecorder({
  onSend,
  onCancel,
}: {
  onSend: (v: RecordedVoice) => void;
  onCancel: () => void;
}) {
  const { c } = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Ask, configure, and start — in that order, once. Recording without
  // `allowsRecording` set produces a silent file on iOS rather than an error,
  // which is the kind of bug you only find after shipping.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const perm = await requestRecordingPermissionsAsync();
      if (cancelled) return;
      if (!perm.granted) {
        Alert.alert("Microphone access needed", "Allow microphone access to record a voice note.");
        onCancel();
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (cancelled) return;
      try {
        await recorder.prepareToRecordAsync();
        recorder.record();
        setReady(true);
      } catch (err) {
        setFailed(err instanceof Error ? err.message : "Couldn't start recording");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only on purpose: re-running this would start a second recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seconds = state.durationMillis ? state.durationMillis / 1000 : (recorder.currentTime ?? 0);

  async function finish() {
    try {
      await recorder.stop();
      // Read the file's location *before* touching the audio session. Tearing
      // down recording mode is what releases the recorder, and a released
      // recorder has no uri to give — which would look exactly like "the
      // recording came back empty" while the file sat on disk perfectly fine.
      const uri = recorder.uri;
      // Put the session back, or playback stays in record mode: on iOS that
      // means the next voice note comes out of the earpiece at a whisper.
      await setAudioModeAsync({ allowsRecording: false });
      if (!uri) {
        setFailed("The recording came back empty");
        return;
      }
      onSend({ uri, durationMs: Math.round(seconds * 1000) });
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Couldn't save the recording");
    }
  }

  async function discard() {
    try {
      if (state.isRecording) await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
    } catch {
      /* Nothing useful to do — we're throwing the recording away anyway. */
    }
    onCancel();
  }

  if (failed) {
    return (
      <View className="flex-row items-center gap-3 px-1 py-2">
        <Text style={{ color: c.danger }} className="flex-1 text-sm">
          {failed}
        </Text>
        <Touchable feel="chip" onPress={onCancel} accessibilityRole="button" className="px-2 py-1">
          <Text style={{ color: c.brandStrong }} className="text-md font-semibold">
            Close
          </Text>
        </Touchable>
      </View>
    );
  }

  return (
    <View
      style={{ backgroundColor: c.surface2 }}
      className="flex-row items-center gap-3 rounded-24 px-2 py-1.5"
      accessibilityLabel="Recording a voice message"
    >
      <Touchable feel="chip"
        onPress={() => void discard()}
        accessibilityRole="button"
        accessibilityLabel="Delete recording"
        hitSlop={8}
        className="h-9 w-9 items-center justify-center rounded-full"
      >
        <TrashIcon size={19} color={c.danger} />
      </Touchable>

      <View
        style={{ backgroundColor: state.isRecording ? c.danger : c.textFaint }}
        className="h-2 w-2 rounded-full"
      />
      <Text style={{ color: c.text }} className="text-lg font-semibold tabular-nums">
        {formatDuration(seconds * 1000)}
      </Text>
      <Text className="flex-1 text-sm text-muted">
        {!ready ? "Starting…" : state.isRecording ? "Recording…" : "Paused"}
      </Text>

      {ready ? (
        <Touchable feel="chip"
          onPress={() => (state.isRecording ? recorder.pause() : recorder.record())}
          accessibilityRole="button"
          accessibilityLabel={state.isRecording ? "Pause recording" : "Resume recording"}
          hitSlop={8}
          className="h-9 w-9 items-center justify-center rounded-full"
        >
          <PauseIcon size={17} color={state.isRecording ? c.textMuted : c.brandStrong} />
        </Touchable>
      ) : null}

      <Touchable feel="chip"
        onPress={() => void finish()}
        disabled={!ready || seconds < 0.5}
        accessibilityRole="button"
        accessibilityLabel="Send voice message"
        hitSlop={4}
        style={{ backgroundColor: c.brand, opacity: ready && seconds >= 0.5 ? 1 : 0.35 }}
        className="h-10 w-10 items-center justify-center rounded-full"
      >
        <SendIcon size={19} color="#fff" />
      </Touchable>
    </View>
  );
}

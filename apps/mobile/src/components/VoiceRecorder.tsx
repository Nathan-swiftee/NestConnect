import { Text, View } from "react-native";
import { formatDuration } from "@ding/client";
import { PauseIcon, SendIcon, TrashIcon } from "../icons";
import { useTheme } from "../theme";
import { MIN_MS, type VoiceRecording } from "../voice";
import { Touchable } from "./Touchable";

export type { RecordedVoice } from "../voice";

/**
 * The hands-free half of recording a voice note.
 *
 * You get here by sliding *up* off the microphone while holding it, which locks
 * the recording — WhatsApp's arrangement, and the reason this panel no longer
 * starts the recorder itself. It used to: mounting it began recording, which is
 * the right shape for a mode you tap into and the wrong one for a hold, where
 * the microphone must already be live before anything decides what to draw. The
 * engine moved to `useVoiceRecording`, and both this and the press-and-hold
 * button drive the same one.
 *
 * It replaces the input row rather than floating over it, because while you're
 * recording there is nothing else to do — the row's three states (delete, the
 * running clock, send) are the whole interaction. The destructive action sits
 * furthest from the send button, so a thumb reaching for one can't hit the
 * other.
 *
 * Pause exists because a voice note is often interrupted, and losing thirty
 * seconds of explanation to a passing lorry is worse than an extra control.
 */
export function VoiceRecorder({
  voice,
  onSend,
  onCancel,
}: {
  voice: VoiceRecording;
  /** Stop and hand the file to the composer. */
  onSend: () => void;
  onCancel: () => void;
}) {
  const { c } = useTheme();
  const sendable = voice.live && voice.seconds * 1000 >= MIN_MS;

  if (voice.failed) {
    return (
      <View className="flex-row items-center gap-3 px-1 py-2">
        <Text style={{ color: c.danger }} className="flex-1 text-sm">
          {voice.failed}
        </Text>
        <Touchable
          feel="chip"
          onPress={() => {
            voice.clearFailure();
            onCancel();
          }}
          accessibilityRole="button"
          className="px-2 py-1"
        >
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
      <Touchable
        feel="chip"
        onPress={onCancel}
        haptic="warning"
        accessibilityRole="button"
        accessibilityLabel="Delete recording"
        hitSlop={8}
        className="h-9 w-9 items-center justify-center rounded-full"
      >
        <TrashIcon size={19} color={c.danger} />
      </Touchable>

      <View
        style={{ backgroundColor: voice.isRecording ? c.danger : c.textFaint }}
        className="h-2 w-2 rounded-full"
      />
      <Text style={{ color: c.text }} className="text-lg font-semibold tabular-nums">
        {formatDuration(voice.seconds * 1000)}
      </Text>
      <Text className="flex-1 text-sm text-muted">
        {!voice.live ? "Starting…" : voice.isRecording ? "Recording…" : "Paused"}
      </Text>

      {voice.live ? (
        <Touchable
          feel="chip"
          onPress={() => (voice.isRecording ? voice.pause() : voice.resume())}
          accessibilityRole="button"
          accessibilityLabel={voice.isRecording ? "Pause recording" : "Resume recording"}
          hitSlop={8}
          className="h-9 w-9 items-center justify-center rounded-full"
        >
          <PauseIcon size={17} color={voice.isRecording ? c.textMuted : c.brandStrong} />
        </Touchable>
      ) : null}

      <Touchable
        feel="chip"
        onPress={onSend}
        disabled={!sendable}
        haptic="success"
        accessibilityRole="button"
        accessibilityLabel="Send voice message"
        hitSlop={4}
        style={{ backgroundColor: c.brand, opacity: sendable ? 1 : 0.35 }}
        className="h-10 w-10 items-center justify-center rounded-full"
      >
        <SendIcon size={19} color="#fff" />
      </Touchable>
    </View>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { NESTCHAT_VOICE_MAX_MS } from "@ding/schemas";
import { clockDuration, startRecording, type Recorder, type VoiceNote } from "./voice";

/** How far the thumb has to travel left before letting go throws the note
 *  away. Far enough that a shaky hold does not cancel, near enough to reach
 *  with the thumb that is already holding the button. */
const CANCEL_PX = 90;

/**
 * Hold to talk, slide to cancel.
 *
 * The gesture everybody already knows, and it is worth saying why it is a hold
 * rather than a tap-to-start-tap-to-stop toggle: a hold cannot be left running
 * by accident. Someone who taps to record and gets distracted sends four
 * minutes of a room; someone who holds and gets distracted lets go.
 *
 * Cancelling is a slide rather than a second button because the finger is
 * already down. A "cancel" target somewhere else on the screen means lifting —
 * and lifting is how you send.
 */
export function VoiceRecorder({
  onRecorded,
  onError,
  disabled,
}: {
  onRecorded: (note: VoiceNote) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}): JSX.Element {
  const recorder = useRef<Recorder | null>(null);
  const startX = useRef(0);
  const [armed, setArmed] = useState(false);
  const [bars, setBars] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [slid, setSlid] = useState(0);

  const willCancel = slid >= CANCEL_PX;

  const reset = useCallback(() => {
    recorder.current = null;
    setArmed(false);
    setBars([]);
    setElapsed(0);
    setSlid(0);
  }, []);

  const finish = useCallback(
    async (keep: boolean) => {
      const rec = recorder.current;
      if (!rec) return;
      recorder.current = null;
      if (!keep) {
        rec.cancel();
        reset();
        return;
      }
      const note = await rec.stop();
      reset();
      // Under about a third of a second is a slip, not a message — the press
      // that was meant to be a tap on something else. Sending it would put a
      // click in the thread.
      if (note && note.durationMs >= 350) onRecorded(note);
    },
    [onRecorded, reset],
  );

  const begin = useCallback(
    async (clientX: number) => {
      if (disabled || recorder.current) return;
      startX.current = clientX;
      setArmed(true);
      try {
        recorder.current = await startRecording({
          onTick: (live, ms) => {
            setBars(live);
            setElapsed(ms);
          },
          maxMs: NESTCHAT_VOICE_MAX_MS,
          onMaxReached: () => void finish(true),
        });
      } catch {
        reset();
        // One sentence, and it names the fix. "NotAllowedError" is the
        // browser's word for it and means nothing to the person reading.
        onError("Nest Connect needs permission to use your microphone.");
      }
    },
    [disabled, finish, onError, reset],
  );

  // Bound to the window rather than the button: a finger that slides off the
  // element still belongs to this gesture, and a pointerup delivered
  // elsewhere would otherwise leave the recorder running.
  useEffect(() => {
    if (!armed) return;
    // How far left the thumb has travelled, kept in a ref rather than read
    // back from state: `pointerup` fires in the same tick as the last
    // `pointermove`, so a render-scheduled value would still be the previous
    // one at exactly the moment it decides whether to send or throw away.
    let travelled = 0;
    const track = (e: PointerEvent) => {
      travelled = Math.max(0, startX.current - e.clientX);
      setSlid(travelled);
    };
    const up = () => void finish(travelled < CANCEL_PX);
    // A pointer the browser takes away — a system gesture, a call arriving —
    // is not a decision to send. Thrown away rather than kept.
    const lost = () => void finish(false);

    window.addEventListener("pointermove", track);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", lost);
    return () => {
      window.removeEventListener("pointermove", track);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", lost);
    };
  }, [armed, finish]);

  return (
    <>
      <button
        type="button"
        className={`nc__mic${armed ? " nc__mic--live" : ""}`}
        disabled={disabled}
        onPointerDown={(e) => {
          // The button keeps the pointer so a slide does not hand the gesture
          // to whatever is underneath, and the page does not start scrolling
          // the moment the finger moves.
          e.currentTarget.setPointerCapture?.(e.pointerId);
          void begin(e.clientX);
        }}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Hold to record a voice message"
      >
        <MicIcon />
      </button>

      {armed ? (
        <div className={`nc__rec${willCancel ? " nc__rec--cancel" : ""}`} aria-live="polite">
          <span className="nc__rec-dot" />
          <span className="nc__rec-time">{clockDuration(elapsed)}</span>
          <div className="nc__rec-bars">
            {bars.slice(-28).map((v, i) => (
              <i key={i} style={{ height: `${Math.round(10 + v * 80)}%` }} />
            ))}
          </div>
          <span className="nc__rec-hint" style={{ transform: `translateX(${-Math.min(slid, CANCEL_PX)}px)` }}>
            {willCancel ? "Release to cancel" : "‹ Slide to cancel"}
          </span>
        </div>
      ) : null}
    </>
  );
}

function MicIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
        fill="currentColor"
      />
      <path
        d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V20a1 1 0 1 0 2 0v-3.09A6 6 0 0 0 18 11Z"
        fill="currentColor"
      />
    </svg>
  );
}

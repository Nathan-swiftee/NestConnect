import { useEffect, useRef, useState } from "react";
import type { NestChatAttachment } from "@ding/schemas";
import { clockDuration } from "./voice";

/**
 * A voice note, played in the bubble it arrived in.
 *
 * The bars are the point. A play button and a duration would be enough to
 * listen to it, but a waveform says how long the pauses are, where the
 * sentences end, and whether it is somebody talking or somebody's pocket — all
 * before a byte has been fetched, because the shape travelled with the
 * message.
 *
 * Nothing is downloaded until play is pressed. A thread with ten notes in it
 * would otherwise pull ten files on open, most of which nobody listens to,
 * onto a connection that is very often a phone's.
 */
export function VoiceNote({
  attachment,
  src,
  mine,
}: {
  attachment: NestChatAttachment;
  src: string | undefined;
  /** The visitor's own note. Only changes the colours. */
  mine: boolean;
}): JSX.Element {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [failed, setFailed] = useState(false);

  const bars = attachment.waveform?.length ? attachment.waveform : FALLBACK_BARS;
  const total = attachment.durationMs ?? 0;
  // While playing we prefer the element's own clock: a note whose stored
  // duration is slightly out — a recorder that rounded, a stream still
  // buffering — should still have its progress line reach the end exactly as
  // the sound stops.
  const elapsed = playing || at > 0 ? at : total;
  const progress = total > 0 ? Math.min(1, at / total) : 0;

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const tick = () => setAt(el.currentTime * 1000);
    const done = () => {
      setPlaying(false);
      // Back to the start, so the next press replays rather than doing
      // nothing — an ended element sitting at its own end is the commonest
      // way a second tap appears to be ignored.
      setAt(0);
      el.currentTime = 0;
    };
    el.addEventListener("timeupdate", tick);
    el.addEventListener("ended", done);
    el.addEventListener("error", () => setFailed(true));
    return () => {
      el.removeEventListener("timeupdate", tick);
      el.removeEventListener("ended", done);
    };
  }, []);

  const toggle = () => {
    const el = audio.current;
    if (!el || !src) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    // Pausing whatever else is running first. Two notes playing over each
    // other is never what anybody meant by pressing the second one.
    document.querySelectorAll("audio").forEach((other) => {
      if (other !== el) other.pause();
    });
    void el.play().then(
      () => setPlaying(true),
      () => setFailed(true),
    );
  };

  /** Scrub by clicking the bars — the whole strip is the timeline. */
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audio.current;
    if (!el || !total) return;
    const box = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    el.currentTime = (ratio * total) / 1000;
    setAt(ratio * total);
  };

  return (
    <div className={`nc__voice${mine ? " nc__voice--mine" : ""}`}>
      <button
        type="button"
        className="nc__voice-play"
        onClick={toggle}
        disabled={!src || failed}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div
        className="nc__voice-bars"
        onClick={seek}
        role="presentation"
        style={{ "--nc-voice-progress": progress } as React.CSSProperties}
      >
        {bars.map((v, i) => (
          <i
            key={i}
            // The played part is coloured by comparing each bar's own position
            // with the progress, rather than by overlaying a second element —
            // an overlay would have to clip mid-bar and would shimmer as it
            // crossed one.
            className={i / bars.length < progress ? "nc__voice-bar nc__voice-bar--done" : "nc__voice-bar"}
            style={{ height: `${Math.round(12 + v * 76)}%` }}
          />
        ))}
      </div>

      <span className="nc__voice-time">
        {failed ? "Unavailable" : clockDuration(elapsed)}
      </span>

      {/* `preload="none"`: see above — a thread of notes should not fetch
          every one of them on open. */}
      {src ? <audio ref={audio} src={src} preload="none" /> : null}
    </div>
  );
}

/** What a note with no measured shape draws. Deliberately uneven — a row of
 *  identical bars reads as a loading state rather than as audio. */
const FALLBACK_BARS = [0.3, 0.6, 0.4, 0.8, 0.5, 0.7, 0.35, 0.65, 0.45, 0.55];

function PlayIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
    </svg>
  );
}

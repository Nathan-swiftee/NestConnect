import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:nestconnect_client/nestconnect_client.dart';

import 'theme.dart';

/// The bars a note carries, and what to draw when it carries none.
///
/// Deliberately uneven. A row of identical bars reads as a loading state
/// rather than as audio.
const _fallbackBars = <double>[0.3, 0.6, 0.4, 0.8, 0.5, 0.7, 0.35, 0.65, 0.45, 0.55];

/// "0:07" — what a bubble says under a note.
String formatDuration(Duration d) {
  final total = d.inSeconds < 0 ? 0 : d.inSeconds;
  final seconds = (total % 60).toString().padLeft(2, '0');
  return '${total ~/ 60}:$seconds';
}

/// Squash however many samples were taken into the bars a bubble draws.
///
/// Peak per bucket, not mean, and that is the whole difference between a
/// waveform that looks like speech and one that looks like a hedge. Speech is
/// mostly quiet — the gaps between words are real silence — so averaging pulls
/// every bar toward the middle and produces an even block. The loudest moment
/// in each bucket keeps the syllables.
List<double> toBars(List<double> samples, {int bars = 60}) {
  if (samples.isEmpty) return const [];
  if (samples.length <= bars) {
    return samples.map((v) => v.clamp(0.0, 1.0)).toList(growable: false);
  }
  final out = <double>[];
  final per = samples.length / bars;
  for (var i = 0; i < bars; i++) {
    final from = (i * per).floor();
    final to = math.max(from + 1, ((i + 1) * per).floor());
    var peak = 0.0;
    for (var j = from; j < to && j < samples.length; j++) {
      peak = math.max(peak, samples[j]);
    }
    out.add(peak.clamp(0.0, 1.0));
  }
  return out;
}

/// Lift the quiet parts so a normal speaking voice fills the bubble.
///
/// A phone microphone at arm's length reads low, and drawn honestly that is a
/// flat line with two bumps. Every messenger normalises this: the note is not
/// a measurement, it is a picture of somebody talking, and it should look like
/// they were there. Floored, so near-silence draws as a thin line rather than
/// as nothing at all.
List<double> normalise(List<double> samples) {
  if (samples.isEmpty) return const [];
  final peak = samples.fold<double>(0, math.max);
  if (peak <= 0) return List<double>.filled(samples.length, 0.06);
  return samples
      .map((v) => math.max(0.06, math.pow(v / peak, 0.7).toDouble()).clamp(0.0, 1.0))
      .toList(growable: false);
}

/// Turn the recorder's amplitude, in dBFS, into 0..1.
///
/// `record` reports decibels relative to full scale: 0 is as loud as the
/// hardware goes and anything quiet is a large negative number. −45 dB is
/// about the noise floor of a room, so that is treated as silence rather than
/// mapping the whole range and drawing a bubble full of hiss.
double levelFromDb(double db) {
  if (!db.isFinite) return 0;
  const floor = -45.0;
  if (db <= floor) return 0;
  return ((db - floor) / -floor).clamp(0.0, 1.0);
}

/// The bars themselves — shared by the player and the live meter, so a note
/// looks the same while it is being recorded and after it has been sent.
class NestWaveform extends StatelessWidget {
  const NestWaveform({
    super.key,
    required this.bars,
    required this.color,
    this.playedColor,
    this.progress = 0,
    this.height = 26,
  });

  final List<double> bars;
  final Color color;

  /// The part already played. Null while recording, where nothing is behind.
  final Color? playedColor;
  final double progress;
  final double height;

  @override
  Widget build(BuildContext context) {
    final shown = bars.isEmpty ? _fallbackBars : bars;
    return SizedBox(
      height: height,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          for (var i = 0; i < shown.length; i++)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 1),
                child: AnimatedContainer(
                  // Short enough to track a voice, long enough that the bars
                  // glide between samples rather than snapping.
                  duration: const Duration(milliseconds: 90),
                  height: math.max(3, shown[i] * height),
                  decoration: BoxDecoration(
                    // Each bar colours itself by comparing its own position
                    // with the playhead. An overlay would have to clip
                    // mid-bar, and would shimmer as it crossed one.
                    color: playedColor != null && i / shown.length < progress
                        ? playedColor
                        : color,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A voice note, played in the bubble it arrived in.
///
/// Nothing is fetched until play is pressed: a thread with ten notes in it
/// would otherwise pull ten files on open, most of which nobody listens to,
/// over a connection that is usually a phone's.
class NestVoiceNote extends StatefulWidget {
  const NestVoiceNote({
    super.key,
    required this.attachment,
    required this.source,
    required this.mine,
    required this.theme,
  });

  final NestAttachment attachment;

  /// Where to play it from — a URL on the server, or a file still on its way.
  final Uri? source;
  final bool mine;
  final NestTheme theme;

  @override
  State<NestVoiceNote> createState() => _NestVoiceNoteState();
}

class _NestVoiceNoteState extends State<NestVoiceNote> {
  AudioPlayer? _player;
  StreamSubscription<Duration>? _ticks;
  StreamSubscription<PlayerState>? _states;
  Duration _at = Duration.zero;
  bool _playing = false;
  bool _failed = false;

  Duration get _total => Duration(milliseconds: widget.attachment.durationMs ?? 0);

  @override
  void dispose() {
    unawaited(_ticks?.cancel());
    unawaited(_states?.cancel());
    unawaited(_player?.dispose());
    super.dispose();
  }

  Future<void> _toggle() async {
    final src = widget.source;
    if (src == null || _failed) return;

    if (_playing) {
      await _player?.pause();
      if (mounted) setState(() => _playing = false);
      return;
    }

    try {
      final player = _player ??= AudioPlayer();
      if (_player != null && _ticks == null) {
        _ticks = player.positionStream.listen((p) {
          if (mounted) setState(() => _at = p);
        });
        _states = player.playerStateStream.listen((s) {
          if (!mounted) return;
          if (s.processingState == ProcessingState.completed) {
            // Back to the start, so the next press replays. A player left
            // sitting at its own end is the commonest way a second tap
            // appears to be ignored.
            setState(() {
              _playing = false;
              _at = Duration.zero;
            });
            unawaited(player.seek(Duration.zero));
            unawaited(player.pause());
          } else {
            setState(() => _playing = s.playing);
          }
        });
      }
      if (player.audioSource == null) await player.setUrl(src.toString());
      await player.play();
    } catch (_) {
      // A note that will not load is said so rather than left as a button
      // that does nothing when pressed.
      if (mounted) setState(() => _failed = true);
    }
  }

  Future<void> _seek(double ratio) async {
    final ms = (_total.inMilliseconds * ratio).round();
    setState(() => _at = Duration(milliseconds: ms));
    await _player?.seek(Duration(milliseconds: ms));
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.theme;
    final foreground = widget.mine ? t.onMine : t.onTheirs;
    final progress = _total.inMilliseconds == 0
        ? 0.0
        : (_at.inMilliseconds / _total.inMilliseconds).clamp(0.0, 1.0);
    // While playing, the player's own clock: a note whose stored duration
    // rounded should still have its line reach the end as the sound stops.
    final shown = _playing || _at > Duration.zero ? _at : _total;

    return Container(
      constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.72),
      padding: const EdgeInsets.fromLTRB(8, 8, 14, 8),
      decoration: BoxDecoration(
        color: widget.mine ? t.mine : t.theirs,
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(18),
          topRight: const Radius.circular(18),
          bottomLeft: Radius.circular(widget.mine ? 18 : 6),
          bottomRight: Radius.circular(widget.mine ? 6 : 18),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Semantics(
            button: true,
            label: _playing ? 'Pause voice message' : 'Play voice message',
            child: InkWell(
              onTap: _toggle,
              customBorder: const CircleBorder(),
              child: Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: foreground.withValues(alpha: 0.18),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  _playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
                  size: 20,
                  color: foreground,
                ),
              ),
            ),
          ),
          const SizedBox(width: 9),
          Flexible(
            child: LayoutBuilder(
              builder: (context, box) => GestureDetector(
                // The whole strip is the timeline. Scrubbing by dragging is
                // what a thumb reaches for, and a note is too short for a
                // separate slider to be worth the room.
                onTapDown: (d) => unawaited(_seek(d.localPosition.dx / box.maxWidth)),
                onHorizontalDragUpdate: (d) =>
                    unawaited(_seek((d.localPosition.dx / box.maxWidth).clamp(0.0, 1.0))),
                behavior: HitTestBehavior.opaque,
                child: NestWaveform(
                  bars: widget.attachment.waveform,
                  color: foreground.withValues(alpha: 0.35),
                  playedColor: foreground,
                  progress: progress,
                ),
              ),
            ),
          ),
          const SizedBox(width: 9),
          Text(
            _failed ? 'Unavailable' : formatDuration(shown),
            style: TextStyle(
              fontSize: 11.5,
              color: foreground.withValues(alpha: 0.75),
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

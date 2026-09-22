import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:record/record.dart';

import 'theme.dart';
import 'voice.dart';

/// How far the thumb has to travel left before letting go throws the note
/// away. Far enough that a shaky hold does not cancel, near enough to reach
/// with the thumb already holding the button.
const _cancelDistance = 90.0;

/// Under this is a slip, not a message — the press that was meant to be a tap
/// on something else. Sending it would put a click in the thread.
const _minimumNote = Duration(milliseconds: 350);

/// The longest note. Somebody still holding after five minutes has forgotten
/// they are holding it, and the alternative to stopping is a file nobody will
/// listen to.
const _maximumNote = Duration(minutes: 5);

/// A finished recording, with the shape measured while it was made.
class RecordedNote {
  const RecordedNote({
    required this.bytes,
    required this.mime,
    required this.duration,
    required this.waveform,
  });

  final List<int> bytes;
  final String mime;
  final Duration duration;
  final List<double> waveform;
}

/// Hold to talk, slide to cancel.
///
/// A hold rather than a tap-to-start-tap-to-stop toggle, because a hold cannot
/// be left running by accident: somebody who taps to record and gets
/// distracted sends four minutes of a room; somebody who holds and gets
/// distracted lets go.
///
/// Cancelling is a slide rather than a second button because the finger is
/// already down, and a target somewhere else on the screen means lifting —
/// which is how you send.
class NestRecorderButton extends StatefulWidget {
  const NestRecorderButton({
    super.key,
    required this.theme,
    required this.onRecorded,
    required this.onError,
    this.enabled = true,
  });

  final NestTheme theme;
  final ValueChanged<RecordedNote> onRecorded;
  final ValueChanged<String> onError;
  final bool enabled;

  @override
  State<NestRecorderButton> createState() => _NestRecorderButtonState();
}

class _NestRecorderButtonState extends State<NestRecorderButton> {
  final _recorder = AudioRecorder();
  Timer? _ticker;
  DateTime? _startedAt;
  final _samples = <double>[];

  double _slid = 0;
  bool _armed = false;
  Duration _elapsed = Duration.zero;

  bool get _willCancel => _slid >= _cancelDistance;

  @override
  void dispose() {
    _ticker?.cancel();
    unawaited(_recorder.dispose());
    super.dispose();
  }

  Future<void> _begin() async {
    if (!widget.enabled || _armed) return;
    try {
      // Asked here rather than at startup, so an app that merely opens the
      // chat never sees a microphone prompt.
      if (!await _recorder.hasPermission()) {
        widget.onError('Nest Connect needs permission to use your microphone.');
        return;
      }
      final dir = Directory.systemTemp.createTempSync('nest_voice');
      final path = '${dir.path}/voice.m4a';
      await _recorder.start(
        const RecordConfig(
          // AAC in an m4a: played by everything on both platforms without a
          // transcode, and small enough for speech over a phone connection.
          encoder: AudioEncoder.aacLc,
          bitRate: 64000,
          sampleRate: 44100,
        ),
        path: path,
      );
      _startedAt = DateTime.now();
      _samples.clear();
      setState(() {
        _armed = true;
        _slid = 0;
        _elapsed = Duration.zero;
      });
      HapticFeedback.selectionClick();

      _ticker = Timer.periodic(const Duration(milliseconds: 70), (_) async {
        final amp = await _recorder.getAmplitude();
        if (!mounted || !_armed) return;
        _samples.add(levelFromDb(amp.current));
        final elapsed = DateTime.now().difference(_startedAt!);
        setState(() => _elapsed = elapsed);
        if (elapsed >= _maximumNote) await _finish(keep: true);
      });
    } catch (_) {
      widget.onError('That microphone could not be started.');
      await _reset();
    }
  }

  Future<void> _finish({required bool keep}) async {
    if (!_armed) return;
    _ticker?.cancel();
    _ticker = null;
    final duration = DateTime.now().difference(_startedAt ?? DateTime.now());
    final path = await _recorder.stop();
    final bars = normalise(toBars(List<double>.from(_samples)));
    await _reset();

    if (!keep || path == null || duration < _minimumNote) {
      // Thrown away rather than sent — and the file with it, so a cancelled
      // note does not sit in the cache directory of somebody's phone.
      if (path != null) unawaited(File(path).delete().catchError((_) => File(path)));
      return;
    }

    try {
      final bytes = await File(path).readAsBytes();
      unawaited(File(path).delete().catchError((_) => File(path)));
      widget.onRecorded(
        RecordedNote(
          bytes: bytes,
          mime: 'audio/mp4',
          duration: duration,
          waveform: bars,
        ),
      );
      HapticFeedback.lightImpact();
    } catch (_) {
      widget.onError('That voice message could not be read.');
    }
  }

  Future<void> _reset() async {
    _startedAt = null;
    if (mounted) {
      setState(() {
        _armed = false;
        _slid = 0;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.theme;
    return GestureDetector(
      onLongPressStart: (_) => unawaited(_begin()),
      // The finger is tracked to the window's coordinates, not the button's,
      // so sliding off the button still belongs to this gesture.
      onLongPressMoveUpdate: (d) {
        if (!_armed) return;
        final slid = -d.offsetFromOrigin.dx;
        setState(() => _slid = slid < 0 ? 0 : slid);
      },
      onLongPressEnd: (_) => unawaited(_finish(keep: !_willCancel)),
      // A gesture the system takes away — a call arriving, a back swipe — is
      // not a decision to send.
      onLongPressCancel: () => unawaited(_finish(keep: false)),
      child: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.centerRight,
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOutBack,
            width: _armed ? 44 : 38,
            height: _armed ? 44 : 38,
            decoration: BoxDecoration(
              color: _armed ? t.accent : Colors.transparent,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.mic_rounded,
              size: 21,
              color: _armed ? t.onAccent : t.muted,
            ),
          ),
          if (_armed)
            Positioned(
              right: 48,
              child: _RecordingStrip(
                theme: t,
                elapsed: _elapsed,
                bars: normalise(toBars(List<double>.from(_samples), bars: 28)),
                willCancel: _willCancel,
                slid: _slid,
              ),
            ),
        ],
      ),
    );
  }
}

/// What is shown while the button is held: how long, how loud, and how to stop.
class _RecordingStrip extends StatelessWidget {
  const _RecordingStrip({
    required this.theme,
    required this.elapsed,
    required this.bars,
    required this.willCancel,
    required this.slid,
  });

  final NestTheme theme;
  final Duration elapsed;
  final List<double> bars;
  final bool willCancel;
  final double slid;

  @override
  Widget build(BuildContext context) {
    const danger = Color(0xFFB42318);
    final width = MediaQuery.of(context).size.width * 0.6;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      width: width,
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        // Past the threshold the whole strip turns, so "will letting go send
        // this" is readable at a glance rather than by reading.
        color: willCancel ? danger.withValues(alpha: 0.12) : theme.surface,
        borderRadius: BorderRadius.circular(22),
        boxShadow: const [
          BoxShadow(color: Color(0x22101828), blurRadius: 18, offset: Offset(0, 6)),
        ],
      ),
      child: Row(
        children: [
          const _PulsingDot(),
          const SizedBox(width: 8),
          Text(
            formatDuration(elapsed),
            style: TextStyle(
              fontSize: 12.5,
              color: theme.onTheirs,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: NestWaveform(
              bars: bars,
              color: willCancel ? danger : theme.accent,
              height: 22,
            ),
          ),
          const SizedBox(width: 10),
          Transform.translate(
            offset: Offset(-slid.clamp(0.0, _cancelDistance), 0),
            child: Text(
              willCancel ? 'Release to cancel' : '‹ Slide to cancel',
              style: TextStyle(
                fontSize: 12,
                color: willCancel ? danger : theme.muted,
                fontWeight: willCancel ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PulsingDot extends StatefulWidget {
  const _PulsingDot();

  @override
  State<_PulsingDot> createState() => _PulsingDotState();
}

class _PulsingDotState extends State<_PulsingDot> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
        opacity: Tween<double>(begin: 1, end: 0.35).animate(_c),
        child: Container(
          width: 9,
          height: 9,
          decoration: const BoxDecoration(color: Color(0xFFE5484D), shape: BoxShape.circle),
        ),
      );
}

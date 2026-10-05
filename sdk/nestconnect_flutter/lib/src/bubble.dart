import 'package:flutter/material.dart';
import 'package:nestconnect_client/nestconnect_client.dart';

import 'theme.dart';

/// One message in the thread.
///
/// The web widget's bubble: the customer's in the brand colour on the right,
/// the agent's white and lifted off the panel on the left, each with the corner
/// nearest its speaker cut — the one piece of shape that says who said it
/// without a label. The agent's run ends with their face and a time, the way
/// every messenger worth copying does it, so a column of replies reads as one
/// person talking rather than as a list.
class NestBubble extends StatelessWidget {
  const NestBubble({
    super.key,
    required this.message,
    required this.theme,
    required this.attachmentUrl,
    this.showAuthor = false,
    this.lastOfRun = true,
    this.face,
  });

  final NestMessage message;
  final NestTheme theme;
  final Uri? Function(NestAttachment) attachmentUrl;

  /// Whether to name the agent above the bubble. Only on the first of a run —
  /// repeating it down five consecutive replies is noise.
  final bool showAuthor;

  /// The last of a run from one side: it carries the face and the time. The
  /// rest keep the face's indent so the run stays in one column.
  final bool lastOfRun;

  /// The agent's face, for the last bubble of their run.
  final Widget? face;

  /// The face's column, which every agent bubble is indented by.
  static const faceColumn = 34.0;

  @override
  Widget build(BuildContext context) {
    final mine = message.isMine;
    final background = mine ? theme.mine : theme.theirs;
    final foreground = mine ? theme.onMine : theme.onTheirs;

    final bubble = Container(
      constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.74),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(18),
          topRight: const Radius.circular(18),
          bottomLeft: Radius.circular(mine ? 18 : 6),
          bottomRight: Radius.circular(mine ? 6 : 18),
        ),
        boxShadow: mine ? null : theme.lift,
      ),
      padding: message.attachments.isEmpty
          ? const EdgeInsets.symmetric(horizontal: 14, vertical: 10)
          : const EdgeInsets.all(4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final attachment in message.attachments)
            _Attachment(
              attachment: attachment,
              url: attachmentUrl(attachment),
              foreground: foreground,
            ),
          if (message.body.isNotEmpty)
            Padding(
              padding: message.attachments.isEmpty
                  ? EdgeInsets.zero
                  : const EdgeInsets.fromLTRB(10, 8, 10, 6),
              child: Text(
                message.body,
                style: TextStyle(color: foreground, fontSize: 15, height: 1.42),
              ),
            ),
        ],
      ),
    );

    final status = message.failed
        ? 'Not sent — tap to try again'
        : message.pending
            ? 'Sending…'
            : lastOfRun
                ? nestClock(message.at)
                : null;

    return Padding(
      padding: EdgeInsets.only(top: showAuthor ? 12 : 3, bottom: lastOfRun ? 4 : 0),
      child: Column(
        crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          if (showAuthor && !mine && message.authorName != null)
            Padding(
              padding: const EdgeInsets.only(left: faceColumn + 8, bottom: 4),
              child: Text(
                message.authorName!,
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: theme.muted),
              ),
            ),
          Row(
            mainAxisAlignment: mine ? MainAxisAlignment.end : MainAxisAlignment.start,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (!mine)
                SizedBox(
                  width: faceColumn,
                  child: lastOfRun && face != null
                      ? Align(alignment: Alignment.bottomLeft, child: face)
                      : null,
                ),
              if (!mine) const SizedBox(width: 8),
              Flexible(child: bubble),
            ],
          ),
          if (status != null)
            Padding(
              padding: EdgeInsets.only(
                top: 4,
                left: mine ? 0 : faceColumn + 10,
                right: mine ? 4 : 0,
              ),
              child: Text(
                // "Sending" is worth saying and "Not sent" is worth saying
                // loudly. A failed message that looks sent is the one thing a
                // support chat must never do.
                status,
                style: TextStyle(
                  fontSize: 11,
                  color: message.failed ? const Color(0xFFDC2626) : theme.muted,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// "14:05" — the time a message was sent, in the phone's own day.
String nestClock(DateTime at) {
  final local = at.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  final now = DateTime.now();
  final today = local.year == now.year && local.month == now.month && local.day == now.day;
  final clock = '${two(local.hour)}:${two(local.minute)}';
  return today ? clock : '${local.day}/${local.month} $clock';
}

class _Attachment extends StatelessWidget {
  const _Attachment({required this.attachment, required this.url, required this.foreground});

  final NestAttachment attachment;
  final Uri? url;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    if (attachment.isImage && url != null) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: Image.network(
          url.toString(),
          fit: BoxFit.cover,
          // A picture that will not load must not take the message with it. The
          // words beside it are still the message.
          errorBuilder: (_, __, ___) => _file(),
          loadingBuilder: (_, child, progress) => progress == null
              ? child
              : SizedBox(
                  height: 160,
                  child: Center(
                    child: CircularProgressIndicator(strokeWidth: 2, color: foreground),
                  ),
                ),
        ),
      );
    }
    return _file();
  }

  Widget _file() => Padding(
        padding: const EdgeInsets.fromLTRB(10, 8, 10, 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.attach_file, size: 16, color: foreground),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                attachment.filename,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: foreground, fontSize: 14),
              ),
            ),
          ],
        ),
      );
}

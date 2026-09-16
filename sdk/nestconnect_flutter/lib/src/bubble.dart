import 'package:flutter/material.dart';
import 'package:nestconnect_client/nestconnect_client.dart';

import 'theme.dart';

/// One message in the thread.
///
/// The customer's own sit right and carry the brand colour; the agent's sit
/// left and stay quiet. A thread where both sides shout is a thread where
/// neither side reads.
class NestBubble extends StatelessWidget {
  const NestBubble({
    super.key,
    required this.message,
    required this.theme,
    required this.attachmentUrl,
    this.showAuthor = false,
  });

  final NestMessage message;
  final NestTheme theme;
  final Uri? Function(NestAttachment) attachmentUrl;

  /// Whether to name the agent above the bubble. Only on the first of a run —
  /// repeating it down five consecutive replies is noise.
  final bool showAuthor;

  @override
  Widget build(BuildContext context) {
    final mine = message.isMine;
    final background = mine ? theme.mine : theme.theirs;
    final foreground = mine ? theme.onMine : theme.onTheirs;

    return Padding(
      padding: EdgeInsets.only(top: showAuthor ? 10 : 3, bottom: 1),
      child: Column(
        crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          if (showAuthor && !mine && message.authorName != null)
            Padding(
              padding: const EdgeInsets.only(left: 12, bottom: 4),
              child: Text(
                message.authorName!,
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: theme.muted),
              ),
            ),
          Row(
            mainAxisAlignment: mine ? MainAxisAlignment.end : MainAxisAlignment.start,
            children: [
              Flexible(
                child: Container(
                  // Never the full width: a bubble that reaches both edges
                  // stops reading as somebody speaking and starts reading as a
                  // page of text.
                  constraints: BoxConstraints(
                    maxWidth: MediaQuery.of(context).size.width * 0.78,
                  ),
                  decoration: BoxDecoration(
                    color: background,
                    borderRadius: BorderRadius.only(
                      topLeft: const Radius.circular(18),
                      topRight: const Radius.circular(18),
                      // The corner nearest the speaker is clipped — the one
                      // piece of shape that says which side said it without a
                      // label.
                      bottomLeft: Radius.circular(mine ? 18 : 5),
                      bottomRight: Radius.circular(mine ? 5 : 18),
                    ),
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
                            style: TextStyle(color: foreground, fontSize: 15, height: 1.35),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          if (message.pending || message.failed)
            Padding(
              padding: const EdgeInsets.only(top: 3, right: 6, left: 6),
              child: Text(
                // "Sending" is worth saying and "Not sent" is worth saying
                // loudly. A failed message that looks sent is the one thing a
                // support chat must never do.
                message.failed ? 'Not sent — tap to try again' : 'Sending…',
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

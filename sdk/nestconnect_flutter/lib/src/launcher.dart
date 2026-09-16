import 'package:flutter/material.dart';
import 'package:nestconnect_client/nestconnect_client.dart';

import 'messenger.dart';
import 'theme.dart';

/// Bring the chat up from the bottom of the screen.
///
/// A modal sheet rather than a pushed route: chat is something you glance at
/// and dismiss, not somewhere you navigate to. The app stays visible behind it,
/// which is what makes closing it feel like putting something down rather than
/// going back.
Future<void> showNestMessenger(
  BuildContext context, {
  required NestConnect chat,
  NestFilePicker? onPickFile,
}) {
  return showModalBottomSheet<void>(
    context: context,
    // Full height is available but not taken: the sheet is as tall as it needs
    // to be, and the strip of app above it is what says this is a layer rather
    // than a screen.
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black.withValues(alpha: 0.45),
    builder: (sheetContext) => Padding(
      // The sheet itself moves with the keyboard rather than being resized by
      // it, so the composer stays put and the thread scrolls under it.
      padding: EdgeInsets.only(top: MediaQuery.of(sheetContext).size.height * 0.08),
      child: NestMessenger(
        chat: chat,
        onPickFile: onPickFile,
        onClose: () => Navigator.of(sheetContext).pop(),
      ),
    ),
  );
}

/// A floating button that opens the chat, with a count of what is waiting.
///
/// Stack it over your page. It listens to the unread stream itself, so nothing
/// above it has to hold that state or remember to rebuild.
class NestLauncher extends StatelessWidget {
  const NestLauncher({
    super.key,
    required this.chat,
    this.onPickFile,
    this.icon = Icons.chat_bubble_rounded,
  });

  final NestConnect chat;
  final NestFilePicker? onPickFile;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = NestTheme.from(
      chat.config?.appearance ?? NestAppearance.fallback,
      Theme.of(context).brightness,
    );

    return StreamBuilder<int>(
      stream: chat.onUnread,
      initialData: chat.unread,
      builder: (context, snapshot) {
        final unread = snapshot.data ?? 0;
        return Stack(
          clipBehavior: Clip.none,
          children: [
            FloatingActionButton(
              heroTag: 'nestconnect-launcher',
              backgroundColor: theme.accent,
              foregroundColor: theme.onAccent,
              onPressed: () => showNestMessenger(context, chat: chat, onPickFile: onPickFile),
              child: Icon(icon),
            ),
            if (unread > 0)
              Positioned(
                top: -2,
                right: -2,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  constraints: const BoxConstraints(minWidth: 20),
                  decoration: BoxDecoration(
                    color: const Color(0xFFDC2626),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: theme.surface, width: 2),
                  ),
                  child: Text(
                    // Past nine it stops being a number worth reading and
                    // starts being "several".
                    unread > 9 ? '9+' : '$unread',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

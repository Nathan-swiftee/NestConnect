import 'dart:async';

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
  /// Skip the home screen and open on the conversation.
  bool startOnConversation = false,
  /// What to do when a home card is tapped. Omit it and the link goes to the
  /// phone — a help centre to the browser, a `tel:` to the dialler.
  ValueChanged<NestHomeCard>? onOpenLink,
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
    builder: (sheetContext) {
      final media = MediaQuery.of(sheetContext);
      return Padding(
        // The strip of app above the sheet, which is what says this is a layer
        // rather than a screen — and which goes the moment the keyboard is up.
        // With a keyboard taking half the screen those pixels are the
        // difference between a thread you can read and two lines of one.
        padding: EdgeInsets.only(
          top: media.viewInsets.bottom > 0 ? 0 : media.size.height * 0.08,
        ),
        child: NestMessenger(
          chat: chat,
          onPickFile: onPickFile,
          onOpenLink: onOpenLink,
          startOnConversation: startOnConversation,
          onClose: () => Navigator.of(sheetContext).pop(),
        ),
      );
    },
  );
}

/// Open the chat from a tapped push notification, if it is one of ours.
///
/// Answers whether it was — `false` means the notification belongs to the app
/// and is the app's to handle. Call it from both places a tap arrives:
///
/// ```dart
/// // The app was in the background.
/// FirebaseMessaging.onMessageOpenedApp.listen((m) {
///   openNestNotification(navigatorKey.currentContext!, chat: chat, data: m.data);
/// });
///
/// // The app had been closed, and the tap is what launched it.
/// final initial = await FirebaseMessaging.instance.getInitialMessage();
/// if (initial != null) {
///   openNestNotification(navigatorKey.currentContext!, chat: chat, data: initial.data);
/// }
/// ```
///
/// Opens on the conversation rather than the home screen — somebody tapping a
/// reply wants the reply — and fetches the thread first, because the reply
/// arrived while the app was asleep and nothing was listening for it. If the
/// chat is already open it is brought up to date rather than opened twice.
Future<bool> openNestNotification(
  BuildContext context, {
  required NestConnect chat,
  required Map<String, Object?> data,
  NestFilePicker? onPickFile,
  ValueChanged<NestHomeCard>? onOpenLink,
}) async {
  if (!NestConnect.isNotification(data)) return false;
  await chat.resume();
  // Already open: the refresh above is all it needed, and a second sheet on
  // top of the first is one more to close.
  if (nestMessengersShowing > 0 || !context.mounted) return true;
  unawaited(
    showNestMessenger(
      context,
      chat: chat,
      onPickFile: onPickFile,
      onOpenLink: onOpenLink,
      startOnConversation: true,
    ),
  );
  return true;
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
    this.onOpenLink,
    this.icon = Icons.chat_bubble_rounded,
  });

  final NestConnect chat;
  final NestFilePicker? onPickFile;
  final ValueChanged<NestHomeCard>? onOpenLink;
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
              onPressed: () => showNestMessenger(
                context,
                chat: chat,
                onPickFile: onPickFile,
                onOpenLink: onOpenLink,
              ),
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

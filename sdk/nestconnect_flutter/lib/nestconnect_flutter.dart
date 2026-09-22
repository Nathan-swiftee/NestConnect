/// Nest Connect live chat, inside your Flutter app.
///
/// ```dart
/// final chat = NestConnect(baseUrl: 'https://nestconnect.io', appKey: 'na_…');
/// await chat.login(userId: user.id, name: user.name, userHash: user.nestHash);
/// await chat.open(fields: {'order_id': order.id});
///
/// // A launcher over your page…
/// Stack(children: [page, Positioned(right: 16, bottom: 16, child: NestLauncher(chat: chat))]);
///
/// // …or open it from anywhere.
/// showNestMessenger(context, chat: chat);
/// ```
///
/// The look comes from the channel's own settings, so a brand colour or a
/// greeting changed in Nest Connect reaches customers without an app release.
/// Your app's typography is inherited, so it still reads as part of your app.
library;

export 'package:nestconnect_client/nestconnect_client.dart';

export 'src/bubble.dart' show NestBubble;
export 'src/launcher.dart' show NestLauncher, showNestMessenger;
export 'src/message_row.dart'
    show NestMessageRow, collapseReactions, nestQuickReactions;
export 'src/messenger.dart'
    show NestFilePicker, NestMessenger, NestPickedFile, NestStagedFiles;
export 'src/recorder.dart' show NestRecorderButton, RecordedNote;
export 'src/theme.dart' show NestTheme;
export 'src/voice.dart'
    show NestVoiceNote, NestWaveform, formatDuration, levelFromDb, normalise, toBars;

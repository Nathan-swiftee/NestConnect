/// Talk to a Nest Connect live-chat channel from Dart.
///
/// The transport half of the SDK: sessions, messages, attachments and the live
/// stream, with no UI and no Flutter dependency — so it can be driven from a
/// widget, a test, or a script, and an app that takes it inherits nothing.
///
/// ```dart
/// final chat = NestConnect(baseUrl: 'https://nestconnect.io', appKey: 'na_…');
/// await chat.login(userId: user.id, name: user.name, userHash: user.nestHash);
/// await chat.open(fields: {'order_id': 'DG-88412'});
/// chat.onMessages.listen(render);
/// await chat.send('Where is my order?');
/// ```
library;

export 'src/client.dart' show NestConnect;
export 'src/models.dart';
export 'src/store.dart';
export 'src/transport.dart' show NestTransport;

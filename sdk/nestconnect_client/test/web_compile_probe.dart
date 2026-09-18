// Not a test: an entry point that exists to be compiled for the browser.
//
// `dart compile js` on this is what proves the package builds for Flutter web.
// A unit test cannot prove it — `dart:io` missing in a browser is a *compile*
// error, so the failure this guards against is one that never reaches a test
// run. It is the same check a `flutter build web` of somebody's app would do,
// with none of the app.
import 'package:nestconnect_client/nestconnect_client.dart';

void main() {
  final chat = NestConnect(baseUrl: 'https://example.invalid', appKey: 'na_probe');

  // The transport by name, and enough of it to be retained: dart2js drops what
  // nothing reaches, and a probe that only touched the client would compile
  // happily while tree-shaking away the very file under test.
  final transport = NestTransport(baseUrl: 'https://example.invalid');
  print([
    chat.isOpen,
    chat.messages.length,
    chat.unread,
    transport.mediaUrl('att_1', 'tok').toString(),
    transport.stream('tok').isBroadcast,
    transport.getJson('/config').runtimeType,
    transport.postJson('/message', const <String, Object?>{}).runtimeType,
    transport.upload(token: 't', bytes: const [1], filename: 'a.jpg', mime: 'image/jpeg').runtimeType,
  ]);
  transport.close();
}

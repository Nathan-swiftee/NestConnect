/// The messenger, rendered.
///
/// Driven against a real `HttpServer` and a real `NestConnect`, not a mock, so
/// what is under test is the whole path a customer touches: tap, type, send,
/// and a reply arriving on the stream while the sheet is open.
///
/// The stream events are replayed from sdk/contract/visitor-events.json rather
/// than written here. They used to be written here, in the shape the client
/// happened to read — which is how every agent reply came to be dropped in
/// production while three tests in this file said replies worked.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nestconnect_flutter/nestconnect_flutter.dart';

/// One event from the contract the API is held to, as a fresh mutable copy.
///
/// Read from the file for the same reason its twin in `nestconnect_client` is:
/// a fake server written from the client's expectation tests only that somebody
/// typed the same thing twice.
Map<String, Object?> contractEvent(String kind) {
  final file = File('../contract/visitor-events.json');
  if (!file.existsSync()) {
    throw StateError(
      'Missing ${file.absolute.path}. The visitor-event contract is shared with '
      'the API and this test cannot speak for the server without it.',
    );
  }
  final all = jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
  final event = all[kind];
  if (event is! Map<String, Object?>) throw StateError('The contract has no "$kind" event.');
  return jsonDecode(jsonEncode(event)) as Map<String, Object?>;
}

class FakeServer {
  late HttpServer _server;
  final _events = StreamController<String>.broadcast();
  final sent = <Map<String, Object?>>[];

  String get baseUrl => 'http://${_server.address.host}:${_server.port}';

  Future<void> start() async {
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    unawaited(() async {
      await for (final req in _server) {
        unawaited(_handle(req));
      }
    }());
  }

  Future<void> _handle(HttpRequest req) async {
    final path = req.uri.path;
    final body = await utf8.decoder.bind(req).join();

    if (path.endsWith('/stream')) {
      req.response.headers.contentType = ContentType('text', 'event-stream');
      // Without this the events sit in the server until the response ends,
      // which for a connection held open all session means never.
      req.response.bufferOutput = false;
      var writes = Future<void>.value();
      void push(String data) {
        writes = writes.then((_) async {
          req.response.write(data);
          await req.response.flush();
        }).catchError((Object _) {});
      }

      push(': open\n\n');
      final sub = _events.stream.listen(push);
      await req.response.done.catchError((Object _) {});
      await sub.cancel();
      return;
    }

    req.response.headers.contentType = ContentType.json;
    if (path.endsWith('/config')) {
      req.response.write(jsonEncode({
        'appearance': {
          'accent': '#1f7a3d',
          'onAccent': '#ffffff',
          'title': 'Ding support',
          'subtitle': 'We usually reply in minutes',
          'awayMessage': 'We are closed — leave a message',
          'placeholder': 'Write a message…',
          'showBranding': false,
        },
        'online': true,
        'team': {
          'members': [
            {'name': 'Nathan'},
          ],
        },
      }));
    } else if (path.endsWith('/session')) {
      req.response.write(jsonEncode({
        'token': 'tok_1',
        'hasConversation': true,
        'messages': <Object?>[],
        'identified': true,
        'unknownFields': <Object?>[],
      }));
    } else if (path.endsWith('/message')) {
      sent.add(jsonDecode(body) as Map<String, Object?>);
      req.response.write(jsonEncode({
        'ok': true,
        'message': {
          'id': 'msg_${sent.length}',
          'from': 'visitor',
          'body': (jsonDecode(body) as Map)['body'],
          'at': DateTime.now().toIso8601String(),
        },
      }));
    } else {
      req.response.write(jsonEncode({'ok': true}));
    }
    unawaited(req.response.close());
  }

  void agentSays(String id, String text) {
    final event = contractEvent('message');
    (event['payload']! as Map<String, Object?>)
      ..['id'] = id
      ..['body'] = text
      ..['at'] = DateTime.now().toIso8601String();
    _events.add('data: ${jsonEncode(event)}\n\n');
  }

  Future<void> stop() async {
    await _events.close();
    await _server.close(force: true);
  }
}

/// Wrap a widget in just enough app to render it.
Widget host(Widget child) => MaterialApp(home: Scaffold(body: child));

/// Let real network work happen, then redraw.
///
/// A widget test runs its body against a fake clock, and `pumpAndSettle` only
/// advances that — so a socket that needs actual milliseconds never gets them.
/// `runAsync` steps outside to real time, which is where the server lives.
///
/// It also replaces `pumpAndSettle` wherever a spinner might be on screen:
/// settle waits for every animation to finish, and a progress indicator never
/// finishes, so it times out rather than reporting anything useful.
Future<void> settle(WidgetTester tester, [int ms = 350]) async {
  await tester.runAsync(() => Future<void>.delayed(Duration(milliseconds: ms)));
  await tester.pump();
  await tester.pump();
}

void main() {
  // flutter_test installs an HttpClient that answers 400 to everything, so a
  // test cannot reach the network by accident. Here the network is the point —
  // these run against a real server on loopback — so the real client is put
  // back. Nothing leaves the machine.
  setUpAll(() => HttpOverrides.global = null);

  late FakeServer server;
  late NestConnect chat;

  setUp(() async {
    server = FakeServer();
    await server.start();
    chat = NestConnect(baseUrl: server.baseUrl, appKey: 'na_test');
    await chat.open();
    // Let the config land before anything is drawn.
    await Future<void>.delayed(const Duration(milliseconds: 150));
  });

  tearDown(() async {
    await chat.dispose();
    await server.stop();
  });

  testWidgets('the header speaks the channel\'s own words', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await tester.pump();

    // Set in Settings, on the phone without an app release.
    expect(find.text('Ding support'), findsOneWidget);
    expect(find.text('We usually reply in minutes'), findsOneWidget);
    // Online, so the away message is not the one shown.
    expect(find.text('We are closed — leave a message'), findsNothing);
  });

  testWidgets('an empty thread invites rather than reports emptiness', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await tester.pump();
    expect(find.text('Ask us anything — we read every message.'), findsOneWidget);
  });

  testWidgets('typing and sending puts the message in the thread', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await tester.pump();

    await tester.enterText(find.byType(TextField), 'Where is my order?');

    // One pump after the tap, and no waiting for the network: the message has
    // to be on screen before the server could possibly have answered, which is
    // the whole point of the optimistic path. A thread that shows nothing
    // until the reply lands looks broken on a train.
    await tester.tap(find.byTooltip('Send'));
    await tester.pump();
    expect(find.text('Where is my order?'), findsOneWidget);

    // The composer is cleared on the same frame, so a second tap cannot send
    // it twice. That the message reaches the wire is the client package's
    // business, and is covered there against a real server — through a widget
    // test it would only be re-proving it in a harness that fights it.
    expect(tester.widget<TextField>(find.byType(TextField)).controller?.text, '');
  });

  testWidgets('an agent reply appears while the sheet is open', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    server.agentSays('msg_a', 'On its way!');
    await settle(tester, 500);

    expect(find.text('On its way!'), findsOneWidget);
    // Named once, above the run.
    expect(find.text('Nathan'), findsOneWidget);
  });

  testWidgets('no attach button when the app has no picker', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await tester.pump();
    // Better than a button that opens nothing.
    expect(find.byTooltip('Attach'), findsNothing);
  });

  testWidgets('a picker gets a button, and tapping it asks the app', (tester) async {
    var asked = 0;
    await tester.pumpWidget(host(NestMessenger(
      chat: chat,
      onPickFile: () async {
        asked++;
        return null;
      },
    )));
    await tester.pump();

    expect(find.byTooltip('Attach'), findsOneWidget);
    await tester.tap(find.byTooltip('Attach'));
    await tester.pump();
    // The host app owns the picker — it already has one, and already has the
    // permission. All this does is ask.
    expect(asked, 1);
  });

  testWidgets('a staged file can be taken back off', (tester) async {
    const file = NestUpload(
      ticket: 'tkt', filename: 'curry.jpg', mime: 'image/jpeg', size: 42);
    final staged = [file];

    await tester.pumpWidget(host(StatefulBuilder(
      builder: (context, setState) => NestStagedFiles(
        files: staged,
        onRemove: (f) => setState(() => staged.remove(f)),
      ),
    )));
    expect(find.text('curry.jpg'), findsOneWidget);

    // Picking the wrong photo is the most ordinary mistake there is, and
    // without this the only way back is closing the chat.
    await tester.tap(find.byIcon(Icons.cancel));
    await tester.pump();
    expect(find.text('curry.jpg'), findsNothing);
    expect(staged, isEmpty);
  });

  testWidgets('the launcher badges what is waiting', (tester) async {
    await tester.pumpWidget(host(NestLauncher(chat: chat)));
    await settle(tester);
    expect(find.text('1'), findsNothing);

    server.agentSays('msg_a', 'hello?');
    await settle(tester, 500);
    expect(find.text('1'), findsOneWidget);
  });

  testWidgets('the badge stops counting past nine', (tester) async {
    await tester.pumpWidget(host(NestLauncher(chat: chat)));
    await settle(tester);
    for (var i = 0; i < 12; i++) {
      server.agentSays('msg_$i', 'ping $i');
    }
    await settle(tester, 700);
    // Past nine it stops being a number worth reading.
    expect(find.text('9+'), findsOneWidget);
  });

  testWidgets('the launcher opens the messenger', (tester) async {
    await tester.pumpWidget(host(Builder(
      builder: (context) => NestLauncher(chat: chat),
    )));
    await settle(tester);

    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();
    expect(find.text('Ding support'), findsOneWidget);
  });

  test('a brand colour is read as authored, and refused when it is not', () {
    expect(NestTheme.parseColor('#1f7a3d'), const Color(0xFF1F7A3D));
    expect(NestTheme.parseColor('1f7a3d'), const Color(0xFF1F7A3D));
    // Shorthand, as a stylesheet would write it.
    expect(NestTheme.parseColor('#0a0'), const Color(0xFF00AA00));
    // Refused rather than guessed: a wrong colour on somebody's brand is worse
    // than the default, and silently rendering black is what nobody reports.
    expect(NestTheme.parseColor('rebeccapurple'), isNull);
    expect(NestTheme.parseColor(''), isNull);
    expect(NestTheme.parseColor('#12345'), isNull);
  });
}

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

import 'package:flutter/gestures.dart' show kTouchSlop;
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

  /// Whether this channel has a home screen turned on. Off for most tests, which
  /// is the common configuration and the one every other test is written for.
  bool home = false;

  /// The customer's earlier conversations, as the history endpoint answers them.
  List<Map<String, Object?>> past = const [];

  String get baseUrl => 'http://${_server.address.host}:${_server.port}';

  Future<void> start() async {
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    unawaited(() async {
      await for (final req in _server) {
        // Never allowed to take the loop down. A client that goes away
        // mid-request is ordinary — a widget test ends while a session call is
        // still in flight, and the real server does not treat that as an error
        // either. Left unguarded it surfaces as a failure in whichever test
        // happened to be last, which is a fault report pointing at the wrong
        // place entirely.
        unawaited(_handle(req).catchError((Object _) {}));
      }
    }());
  }

  Future<void> _handle(HttpRequest req) async {
    final path = req.uri.path;
    final body = await utf8.decoder.bind(req).join();

    if (path.endsWith('/stream')) {
      // The charset is not decoration. Dart writes latin1 when the content
      // type names none, so an event carrying an emoji — which every reaction
      // does — throws on write and never reaches the client.
      req.response.headers.contentType =
          ContentType('text', 'event-stream', charset: 'utf-8');
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

    if (path.contains('/avatar/')) {
      // A real one-pixel PNG. The geometry under test is the circle the photo
      // is clipped to, which is settled by layout and not by whether the bytes
      // decode — but a 404 here would put the error builder's initials on
      // screen instead of an `Image`, and the test would be measuring the
      // fallback.
      req.response.headers.contentType = ContentType('image', 'png');
      // Flutter's image loader keeps its own HttpClient for the life of the
      // process and never closes it, so a kept-alive connection leaves an idle
      // timer behind — which a widget test reports as "a Timer is still
      // pending" in whichever test happens to be running when it fires.
      req.response.persistentConnection = false;
      req.response.add(base64Decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842'
        'iQAAAABJRU5ErkJggg==',
      ));
      unawaited(req.response.close());
      return;
    }

    req.response.headers.contentType = ContentType.json;
    if (path.endsWith('/config')) {
      req.response.write(jsonEncode({
        'appearance': {
          'accent': '#1f7a3d',
          'onAccent': '#ffffff',
          'headline': 'Hello {name} 👋',
          'title': 'Ding support',
          'subtitle': 'We usually reply in minutes',
          'awayMessage': 'We are closed — leave a message',
          'placeholder': 'Write a message…',
          'closedMessage': 'That order is all wrapped up. Thanks!',
          'newChatLabel': 'Ask about something else',
          'showBranding': false,
        },
        'online': true,
        // Sent only when the business enabled it — the key is simply absent
        // otherwise, which is the same answer as "go straight to the chat".
        if (home)
          'home': {
            'enabled': true,
            'chatLabel': 'Send us a message',
            'chatSublabel': 'We usually reply in minutes',
            'cards': [
              {
                'id': 'card_help',
                'label': 'Help centre',
                'sublabel': 'Answers to the usual questions',
                'icon': 'help',
                'href': 'https://help.dingnow.co.uk',
              },
            ],
          },
        // The server's own shape: `faces`, with the details a face is drawn
        // from. This said `members` and carried nothing but a name — written
        // from what the client happened to read rather than from the payload —
        // so the header showed nobody and no test noticed.
        'team': {
          'name': 'Support',
          'total': 2,
          'faces': [
            {
              'name': 'Nathan',
              'initials': 'NA',
              'color': '#3B82F6',
              'online': true,
              // Root-relative, the way the server sends it — the client makes
              // it absolute against the base url, which is what an app needs.
              'avatarUrl': '/api/nestchat/wk_1/avatar/u_9',
            },
            {'name': 'Priya', 'initials': 'PS', 'color': '#DB2777', 'online': false},
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
    } else if (path.endsWith('/conversations')) {
      // Not kept alive. These two are fetched while the test is pumping the fake
      // clock rather than inside a `runAsync` window, so a kept-alive socket's
      // idle timer lands on that clock and is still pending when the widget tree
      // goes — which the binding reports as "a Timer is still pending" against
      // whichever test was unlucky.
      req.response.persistentConnection = false;
      req.response.write(jsonEncode({'conversations': past}));
    } else if (path.contains('/conversations/') && path.endsWith('/messages')) {
      req.response.persistentConnection = false;
      final id = path.split('/conversations/').last.replaceAll('/messages', '');
      req.response.write(jsonEncode({
        'messages': [
          {
            'id': '${id}_m1',
            'from': 'visitor',
            'body': 'My order was missing an item',
            'at': DateTime.now().toIso8601String(),
          },
          {
            'id': '${id}_m2',
            'from': 'agent',
            'authorName': 'Nathan',
            'body': 'Sorted — a replacement is on the way',
            'at': DateTime.now().toIso8601String(),
          },
        ],
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

  /// Play an agent closing the chat, or reopening it.
  void agentSetsStatus(String kind) => _events.add('data: ${jsonEncode(contractEvent(kind))}\n\n');

  /// Play an agent replying — a plain one.
  ///
  /// The contract's sample is deliberately the rich case: a reply with a
  /// recording, a quote and an emoji already on it, because the keys that
  /// vanish in a rename are the optional ones. The extras are cleared here
  /// rather than inherited, so a test about unread badges is not quietly
  /// asserting against a message that arrived pre-reacted — or, worse,
  /// rendering as a waveform where it expects text.
  void agentSays(String id, String text) {
    final event = contractEvent('message');
    (event['payload']! as Map<String, Object?>)
      ..['id'] = id
      ..['body'] = text
      ..['at'] = DateTime.now().toIso8601String()
      ..['reactions'] = <Object?>[]
      ..['attachments'] = <Object?>[]
      ..remove('quote');
    _events.add('data: ${jsonEncode(event)}\n\n');
  }

  /// Play an agent starting to type.
  void agentTypes() => _events.add('data: ${jsonEncode(contractEvent('typing'))}\n\n');

  /// Play an agent reacting to a message.
  void agentReacts(String messageId, String emoji) {
    final event = contractEvent('reaction');
    (event['payload']! as Map<String, Object?>)
      ..['id'] = messageId
      ..['body'] = 'On its way!'
      ..['attachments'] = <Object?>[]
      ..['reactions'] = [
        {'emoji': emoji, 'by': 'agent'},
      ]
      ..remove('quote');
    _events.add('data: ${jsonEncode(event)}\n\n');
  }

  /// Play an agent sending a voice note.
  void agentSendsVoice(String id, {int durationMs = 7400}) {
    final event = contractEvent('message');
    (event['payload']! as Map<String, Object?>)
      ..['id'] = id
      ..['body'] = ''
      ..['at'] = DateTime.now().toIso8601String()
      ..['reactions'] = <Object?>[]
      ..remove('quote');
    final attachments = (event['payload']! as Map<String, Object?>)['attachments']! as List;
    (attachments.first as Map<String, Object?>)['durationMs'] = durationMs;
    _events.add('data: ${jsonEncode(event)}\n\n');
  }

  /// Play an agent replying to something, quoting it.
  void agentQuotes(String id, String text, {required String quotedId, required String preview}) {
    final event = contractEvent('message');
    (event['payload']! as Map<String, Object?>)
      ..['id'] = id
      ..['body'] = text
      ..['at'] = DateTime.now().toIso8601String()
      ..['reactions'] = <Object?>[]
      ..['attachments'] = <Object?>[]
      ..['quote'] = {'id': quotedId, 'from': 'visitor', 'preview': preview};
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
/// Let a modal sheet finish sliding in.
///
/// `settle` advances real time, for the socket; a sheet's entrance runs on the
/// fake clock, and until it is over every rect in the sheet is offset by
/// however much of the slide is left — which reads as a layout bug that isn't
/// one.
Future<void> sheetArrives(WidgetTester tester) async {
  await settle(tester, 400);
  await tester.pump(const Duration(milliseconds: 400));
  await settle(tester, 200);
  await tester.pump(const Duration(milliseconds: 400));
}

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
    // Signed in, like a customer opening the chat from inside an app they are
    // logged into — which is the case the header's greeting is written for.
    await chat.login(userId: 'u_1', name: 'Marta Nowak');
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
    // The composer swaps the microphone for the send button the moment there
    // is anything to send, and a swap is a rebuild: it lands on the next
    // frame, not the one the text arrived on.
    await tester.pump();

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

  testWidgets('a closed chat says so, in the business\'s own words', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);
    expect(find.text('Write a message…'), findsOneWidget);

    server.agentSetsStatus('closed');
    await settle(tester, 500);

    // The composer is replaced, not disabled: a greyed-out field invites a tap
    // and then refuses it, which reads as a broken app rather than a finished
    // conversation.
    expect(find.text('Write a message…'), findsNothing);
    expect(find.text('That order is all wrapped up. Thanks!'), findsOneWidget);
    expect(find.text('Ask about something else'), findsOneWidget);
  });

  testWidgets('and lets the customer start another one', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);
    server.agentSays('msg_a', 'All sorted!');
    server.agentSetsStatus('closed');
    await settle(tester, 500);
    expect(find.text('All sorted!'), findsOneWidget);

    await tester.tap(find.text('Ask about something else'));
    await settle(tester, 500);

    // Without this the screen is a dead end: told the chat is over and given
    // nothing to do about it but dismiss the sheet.
    expect(find.text('Write a message…'), findsOneWidget);
    expect(find.text('All sorted!'), findsNothing);
  });

  testWidgets('the greeting says the customer\'s name', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    // "Hello {name} 👋" went on screen with the braces showing, because the
    // token was only ever filled in on the web.
    expect(find.text('Hello Marta 👋'), findsOneWidget);
    expect(find.textContaining('{name}'), findsNothing);
  });

  test('a greeting with nobody to greet drops the token, never shows it', () {
    // The other way "Hello {name} 👋" reaches a screen: not a stale build but
    // an anonymous visitor. The line has to lose the placeholder *and* the
    // space in front of it, or it reads as a typo rather than as a greeting.
    expect(fillVisitorName('Hello {name} 👋', null), 'Hello 👋');
    expect(fillVisitorName('Hello {name} 👋', '   '), 'Hello 👋');
    // A full name is greeted by its first part — a surname on a chat header
    // reads as a database record rather than as somebody saying hello.
    expect(fillVisitorName('Hello {name} 👋', 'Marta Nowak'), 'Hello Marta 👋');
    expect(fillVisitorName('Hello {name} 👋', 'Marta'), 'Hello Marta 👋');
  });

  testWidgets('and the people who answer are shown', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    // Their own initials, not the first letter of their name — for the one who
    // has no photo. The one who does is a photo, which is the point of showing
    // faces at all, and is measured in its own test below.
    expect(find.text('PS'), findsOneWidget);
    expect(find.byType(Image), findsOneWidget);
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

  testWidgets(
      'the thread keeps its height with the keyboard up, and holds what I send',
      (tester) async {
    // The report this is written from: a message sent and not visible until the
    // chat was closed and opened again. Closing it put the keyboard away, which
    // is the whole clue — with the keyboard up, the header, the composer and
    // the keyboard were each paid for out of a column sized to its children,
    // and the thread, the one flexible child, was handed what was left. On a
    // phone this size that was nothing: it was laid out zero pixels tall and
    // the column overflowed on top of that, so the message was sent, stored,
    // and clipped out of sight.
    //
    // Everything here is the production arrangement rather than a widget on a
    // page: the real sheet, a phone-sized screen, a conversation already in
    // progress, and a keyboard up because somebody has just typed.
    tester.view.physicalSize = const Size(750, 1334);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetViewInsets);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => showNestMessenger(context, chat: chat),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await sheetArrives(tester);

    // A conversation already in progress. A thread with nothing in it fits
    // anywhere, and this is about what happens when it does not.
    for (var i = 0; i < 20; i++) {
      server.agentSays('old_$i', 'Something we said earlier, number $i');
    }
    await settle(tester, 400);
    await tester.pump(const Duration(milliseconds: 200));

    // A keyboard the size iOS puts up on this handset.
    tester.view.viewInsets = const FakeViewPadding(bottom: 672);
    await tester.pump();
    await tester.pump();

    final thread = find.byType(ListView);
    final threadBox = tester.getRect(thread);
    // Enough for a couple of bubbles and the one being written. The number is a
    // floor, not a measurement of the current layout: what must never happen
    // again is the thread being squeezed to nothing.
    expect(
      threadBox.height,
      greaterThan(120),
      reason: 'the thread is what the sheet is for; chrome gives way to it',
    );

    await tester.enterText(find.byType(TextField), 'Where is my order?');
    await tester.pump();
    await tester.tap(find.byTooltip('Send'));
    await settle(tester, 400);
    await tester.pump(const Duration(milliseconds: 200));

    final bubble = find.text('Where is my order?');
    expect(bubble, findsOneWidget);
    // In the tree is not the claim. A row built below the fold of a clipped
    // viewport is found by a finder and seen by nobody.
    final bubbleBox = tester.getRect(bubble);
    expect(
      tester.getRect(thread).contains(bubbleBox.topLeft) &&
          tester.getRect(thread).contains(bubbleBox.bottomRight - const Offset(1, 1)),
      isTrue,
      reason: 'the message I just sent is inside the part of the thread on '
          'screen — it was $bubbleBox inside ${tester.getRect(thread)}',
    );
  });

  testWidgets('an agent typing shows as dots, which the reply replaces',
      (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    expect(find.byType(NestTypingDots), findsNothing);

    // The server says "typing" and never says "stopped". For its whole life
    // the client had no case for this event at all, so an agent could type for
    // a minute and the app showed nothing.
    server.agentTypes();
    await settle(tester, 300);
    expect(find.byType(NestTypingDots), findsOneWidget);

    server.agentSays('msg_t', 'Two minutes away!');
    await settle(tester, 300);
    expect(find.text('Two minutes away!'), findsOneWidget);
    // The sentence has arrived, so the ghost of it being written goes with it.
    // Left to time out it is the same words twice, one still being typed.
    expect(find.byType(NestTypingDots), findsNothing);
  });

  testWidgets('and stops believing it after a while with no word', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);
    server.agentTypes();
    await settle(tester, 300);
    expect(find.byType(NestTypingDots), findsOneWidget);

    // Real time, not pumped time: the event arrived over a socket, so the timer
    // that stops believing it is a real one and a pumped clock never reaches it.
    await settle(
      tester,
      NestConnect.typingLifetime.inMilliseconds + 600,
    );
    expect(find.byType(NestTypingDots), findsNothing);
  });

  testWidgets('a face with a photo fills the circle that clips it',
      (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    final photo = find.byType(Image);
    expect(photo, findsOneWidget, reason: 'one of the two faces has a photo');

    // The circle doing the clipping and the photo inside it have to be the same
    // size. They were not: a ring drawn as a `Border` also insets the child by
    // its width, so a 24px photo sat inside a 28px circular clip — which takes
    // nothing off a 24px square but its corners. The report was exactly that:
    // initials came out round, a face came out a rounded square.
    final clip = find.ancestor(of: photo, matching: find.byType(ClipPath));
    expect(clip, findsAtLeastNWidgets(1));
    expect(
      tester.getSize(clip.first),
      tester.getSize(photo),
      reason: 'a photo smaller than its clip is a square with rounded corners',
    );
  });

  group('the home screen', () {
    /// A channel with a front door, and a customer with history behind it.
    ///
    /// Set before the messenger is built but after the session: the config is
    /// fetched per `NestConnect`, and these tests turn it on for a server the
    /// client is already talking to, so the config is re-read here.
    Future<void> openHome(WidgetTester tester) async {
      server.home = true;
      server.past = [
        {
          'id': 'cv_old',
          'closed': true,
          'preview': 'Sorted — a replacement is on the way',
          'from': 'agent',
          'authorName': 'Nathan',
          'at': DateTime.now().subtract(const Duration(days: 2)).toIso8601String(),
        },
      ];
      // A second session, so the config this test configured is the one the
      // client holds.
      await tester.runAsync(() => chat.login(userId: 'u_1', name: 'Marta Nowak'));
      await settle(tester, 250);
      await tester.pumpWidget(host(NestMessenger(chat: chat)));
      await settle(tester, 400);
      await tester.pump(const Duration(milliseconds: 400));
    }

    testWidgets('is where the chat opens, when the business has one', (tester) async {
      await openHome(tester);

      // The channel's own words for its own front door.
      expect(find.text('Send us a message'), findsOneWidget);
      expect(find.text('Help centre'), findsOneWidget);
      // And no composer: nobody has chosen to write anything yet.
      expect(find.byType(TextField), findsNothing);
    });

    testWidgets('and the chat card goes to the conversation', (tester) async {
      await openHome(tester);
      await tester.tap(find.text('Send us a message'));
      await settle(tester, 200);

      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Help centre'), findsNothing);
    });

    testWidgets('an earlier conversation can be read, and not written to',
        (tester) async {
      await openHome(tester);

      // The whole reason this exists: a chat the business resolved used to leave
      // the customer's side entirely — a new session only ever joins an open
      // thread, so everything agreed about their order was readable only by us.
      expect(find.textContaining('Sorted — a replacement is on the way'), findsOneWidget);
      await tester.tap(find.textContaining('Sorted — a replacement is on the way'));
      await settle(tester, 400);

      // Two more windows of real time. The fetch was started by a tap, which
      // runs against the test's fake clock, so the socket only makes progress
      // inside a `runAsync` — one window opens the request and the next carries
      // the answer back.
      await settle(tester, 400);
      await settle(tester, 400);
      expect(find.text('My order was missing an item'), findsOneWidget);
      expect(find.text('This conversation is closed.'), findsOneWidget);
      // Read, not continued. There is nothing to send into a finished thread.
      expect(find.byType(TextField), findsNothing);
    });

    testWidgets('and leaving it comes back to the cards', (tester) async {
      await openHome(tester);
      await tester.tap(find.textContaining('Sorted — a replacement is on the way'));
      await settle(tester, 400);
      await settle(tester, 400);

      await tester.tap(find.text('Back'));
      // The way back re-reads the history: a conversation read and left may have
      // been reopened by an agent while it was on screen, and the row describing
      // it would still say "Resolved".
      await settle(tester, 400);
      await settle(tester, 400);
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.text('Help centre'), findsOneWidget);
    });

    testWidgets('a card hands its link to the app', (tester) async {
      server.home = true;
      await tester.runAsync(() => chat.login(userId: 'u_1', name: 'Marta Nowak'));
      await settle(tester, 250);

      final opened = <String>[];
      await tester.pumpWidget(
        host(NestMessenger(chat: chat, onOpenLink: (card) => opened.add(card.href))),
      );
      await settle(tester, 400);
      await tester.pump(const Duration(milliseconds: 400));

      await tester.tap(find.text('Help centre'));
      await tester.pump();
      expect(opened, ['https://help.dingnow.co.uk']);
    });
  });

  testWidgets('with no home screen, the chat opens on the conversation',
      (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester, 400);
    await tester.pump(const Duration(milliseconds: 400));

    // The default, and the one every app shipped against: a front door is a tap
    // between somebody and the message box, and a business that answers on one
    // channel should not grow one because this feature was added.
    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets('a voice note is a waveform, not a file listed under a bubble',
      (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    server.agentSendsVoice('msg_v');
    await settle(tester, 500);

    // The waveform *is* the message. Wrapping it in an empty text bubble would
    // put a box round it for no reason.
    expect(find.byType(NestVoiceNote), findsOneWidget);
    // Said before a byte of it has been fetched, because the duration
    // travelled with the message.
    expect(find.text('0:07'), findsOneWidget);
  });

  testWidgets('a reply shows what it answers, and says so', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    server.agentQuotes(
      'msg_r',
      'Yes, the blue door',
      quotedId: 'msg_q',
      preview: 'Is it the house on the corner?',
    );
    await settle(tester, 500);

    expect(find.text('Yes, the blue door'), findsOneWidget);
    expect(find.text('Is it the house on the corner?'), findsOneWidget);
    // Whose words are being quoted. Without it the quote is just a second
    // message stuck above the first.
    expect(find.text('You'), findsOneWidget);
  });

  testWidgets('an agent reacting puts the emoji on the message', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    server.agentSays('msg_a', 'On its way!');
    await settle(tester, 500);
    expect(find.text('\u2764\ufe0f'), findsNothing);

    server.agentReacts('msg_a', '\u2764\ufe0f');
    await settle(tester, 500);
    expect(find.text('\u2764\ufe0f'), findsOneWidget);
  });

  testWidgets('swiping a message far enough offers to reply to it',
      (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    server.agentSays('msg_a', 'On its way!');
    await settle(tester, 500);

    // Short of the threshold: a thumb that brushed past a bubble on the way
    // down the thread has not asked for anything.
    //
    // The offsets allow for Flutter's touch slop, which the recogniser eats
    // before it reports a single pixel of movement — a 20px drag delivers
    // about two, which would "pass" this against any threshold at all and
    // prove only that the slop exists.
    await tester.drag(find.text('On its way!'), const Offset(kTouchSlop + 30, 0));
    await tester.pumpAndSettle();
    expect(find.textContaining('Replying to'), findsNothing);

    // Past it.
    await tester.drag(find.text('On its way!'), const Offset(kTouchSlop + 80, 0));
    await tester.pumpAndSettle();
    expect(find.textContaining('Replying to'), findsOneWidget);
    // The message being answered, shown above the box rather than put in it —
    // in the field it would have to be deleted to be cleared.
    expect(find.text('On its way!'), findsWidgets);
  });

  testWidgets('and the reply can be called off', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    server.agentSays('msg_a', 'On its way!');
    await settle(tester, 500);
    await tester.drag(find.text('On its way!'), const Offset(kTouchSlop + 80, 0));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Stop replying'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Replying to'), findsNothing);
  });

  testWidgets('a closed chat can still be read, but not reacted to',
      (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    server.agentSays('msg_a', 'On its way!');
    await settle(tester, 500);
    server.agentSetsStatus('closed');
    await settle(tester, 500);

    await tester.drag(find.text('On its way!'), const Offset(kTouchSlop + 80, 0));
    await tester.pumpAndSettle();
    // Nothing left to do to it. A reply box under a chat that has ended is a
    // box nobody is reading the other end of.
    expect(find.textContaining('Replying to'), findsNothing);
  });

  test('reaction pills count emoji, not people', () {
    final pills = collapseReactions(const [
      NestReaction(emoji: '\ud83d\udc4d', mine: true),
      NestReaction(emoji: '\ud83d\udc4d', mine: false),
      NestReaction(emoji: '\u2764\ufe0f', mine: false),
    ]);
    expect(pills.length, 2);
    expect(pills.first.count, 2);
    // The highlight that says a second tap would remove it has to survive an
    // agent having reacted first.
    expect(pills.first.mine, isTrue);
    expect(pills.last.mine, isFalse);
  });

  test('a waveform keeps the syllables rather than averaging them away', () {
    // Speech is mostly gaps. A bucket holding one loud moment and three silent
    // ones is a syllable, and a mean would draw it as a quarter-height smudge.
    expect(toBars([1, 0, 0, 0, 1, 0, 0, 0], bars: 2), [1, 1]);
    // Six bars for a one-second note is honest; sixty interpolated from six is
    // a drawing of nothing.
    expect(toBars([0.2, 0.9, 0.4], bars: 60), hasLength(3));
    expect(toBars(const [], bars: 60), isEmpty);
  });

  test('and fills the bubble for a normal speaking voice', () {
    expect(normalise([0.08, 0.12, 0.05, 0.11]).reduce((a, b) => a > b ? a : b), 1.0);
    // Near-silence draws as a line rather than as nothing at all.
    expect(normalise([0, 0, 0]).every((v) => v > 0), isTrue);
  });

  test('the recorder treats room noise as silence', () {
    // `record` reports dBFS: 0 is as loud as the hardware goes, and about
    // -45 is the noise floor of a room. Mapping the whole range would draw a
    // bubble full of hiss.
    expect(levelFromDb(-60), 0);
    expect(levelFromDb(0), 1);
    expect(levelFromDb(double.negativeInfinity), 0);
    expect(levelFromDb(-22.5), closeTo(0.5, 0.01));
  });

  test('a duration reads like a clock', () {
    expect(formatDuration(const Duration(milliseconds: 7400)), '0:07');
    expect(formatDuration(const Duration(seconds: 65)), '1:05');
    expect(formatDuration(Duration.zero), '0:00');
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

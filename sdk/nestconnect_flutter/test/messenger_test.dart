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

  /// Holds the history back, so what is on screen while it loads can be seen.
  Completer<void>? holdHistory;

  /// Each "is the chat on screen" the app reported, in order.
  final viewing = <bool>[];

  /// The current thread, as the server has it — what a returning app fetches
  /// to catch up on replies it slept through.
  List<Map<String, Object?>> thread = const [];

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

    if (path.contains('/avatar/') || path.endsWith('/logo')) {
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

    // "The chat is no longer on screen" is said as the messenger closes, on the
    // test's fake clock. A kept-alive socket would leave its idle timer there,
    // pending, after the test has ended.
    if (path.endsWith('/viewing')) {
      req.response.persistentConnection = false;
      viewing.add((jsonDecode(body) as Map)['viewing'] == true);
    }
    req.response.headers.contentType = ContentType.json;
    if (path.endsWith('/config')) {
      req.response.write(jsonEncode({
        'appearance': {
          'accent': '#1f7a3d',
          // The server's key. The client read `onAccent`, which has never
          // existed, so every business's choice was replaced with white.
          'accentText': '#fffbe6',
          'logoUrl': '/api/nestchat/wk_1/logo',
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
              {
                'id': 'card_wa',
                'label': 'Message us on WhatsApp',
                'sublabel': 'Avg response time: 3 mins',
                'icon': 'whatsapp',
                'href': 'https://wa.me/447000000000',
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
      await holdHistory?.future;
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
    } else if (path.endsWith('/messages')) {
      req.response.persistentConnection = false;
      req.response.write(jsonEncode({'messages': thread}));
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

/// `testWidgets`, then the chat closed and given the real time to say so.
///
/// Closing the messenger tells the server the chat is no longer on screen —
/// it has to, or the reply that arrives next is never pushed. That is a
/// request, and a widget test's fake clock cannot finish one by itself, so
/// without this the binding reports its connection timer as pending against
/// every test that ever showed the chat.
void chatTest(String description, WidgetTesterCallback body) {
  testWidgets(description, (tester) async {
    await body(tester);
    // The minimised bar is the app's, not a screen's: put away between tests.
    hideNestMinimised();
    await tester.pumpWidget(const SizedBox());
    await settle(tester, 300);
    // Closing the chat here, inside the test, rather than in tearDown: the
    // sockets it opened under the fake clock keep timers (connect, keep-alive)
    // that only closing cancels, and the test fails on any still pending.
    unawaited(_openChat?.dispose());
    _openChat = null;
    await settle(tester, 50);
  });
}

/// The chat the current test runs against, for [chatTest] to close.
NestConnect? _openChat;

/// The one agent photo in the header — told apart from the business's logo,
/// which is an image too.
Finder facePhoto() => find.byWidgetPredicate(
      (w) => w is Image && w.image is NetworkImage && (w.image as NetworkImage).url.contains('/avatar/'),
    );

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
    _openChat = chat;
    // Signed in, like a customer opening the chat from inside an app they are
    // logged into — which is the case the header's greeting is written for.
    await chat.login(userId: 'u_1', name: 'Marta Nowak');
    // Let the config land before anything is drawn.
    await Future<void>.delayed(const Duration(milliseconds: 150));
  });

  tearDown(() async {
    // Closed already by [chatTest] — closing twice waits on streams that
    // finished under the fake clock, and never returns.
    await _openChat?.dispose();
    await server.stop();
  });

  chatTest('the header speaks the channel\'s own words', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await tester.pump();

    // Set in Settings, on the phone without an app release.
    expect(find.text('Ding support'), findsOneWidget);
    expect(find.text('We usually reply in minutes'), findsOneWidget);
    // Online, so the away message is not the one shown.
    expect(find.text('We are closed — leave a message'), findsNothing);
  });

  chatTest('an empty thread invites rather than reports emptiness', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await tester.pump();
    expect(find.text('Ask us anything — we read every message.'), findsOneWidget);
  });

  chatTest('typing and sending puts the message in the thread', (tester) async {
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

  chatTest('an agent reply appears while the sheet is open', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    server.agentSays('msg_a', 'On its way!');
    await settle(tester, 500);

    expect(find.text('On its way!'), findsOneWidget);
    // Named once, above the run.
    expect(find.text('Nathan'), findsOneWidget);
  });

  chatTest('a closed chat says so, in the business\'s own words', (tester) async {
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

  chatTest('and lets the customer start another one', (tester) async {
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

  chatTest('a chat in the background says so, so the reply is pushed', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);
    await settle(tester);
    expect(server.viewing.last, isTrue);

    // The app goes to the background with the chat still open. The server
    // took the open stream as "reading it" and sent no notification, so the
    // reply sat there unseen until the app was opened again.
    for (final state in [AppLifecycleState.inactive, AppLifecycleState.hidden, AppLifecycleState.paused]) {
      tester.binding.handleAppLifecycleStateChanged(state);
    }
    // Several windows of real time: the report starts on the fake clock, and
    // each step of a request there (connect, send, answer) needs one.
    for (var i = 0; i < 6; i++) {
      await settle(tester, 150);
    }
    expect(server.viewing.last, isFalse);

    // A reply lands while it is away — and the stream is not what carries it.
    server.thread = [
      {
        'id': 'msg_late',
        'from': 'agent',
        'authorName': 'Nathan',
        'body': 'Your refund has gone through',
        'at': DateTime.now().toIso8601String(),
      },
    ];
    for (final state in [AppLifecycleState.hidden, AppLifecycleState.inactive, AppLifecycleState.resumed]) {
      tester.binding.handleAppLifecycleStateChanged(state);
    }
    await settle(tester);
    await settle(tester);
    await settle(tester);

    expect(server.viewing.last, isTrue);
    expect(find.text('Your refund has gone through'), findsOneWidget);
  });

  group('minimised', () {
    /// The app, with the chat opened from it the way an app does.
    Future<void> openFromApp(WidgetTester tester) async {
      late BuildContext app;
      await tester.pumpWidget(host(Builder(builder: (context) {
        app = context;
        return const SizedBox.expand();
      })));
      unawaited(showNestMessenger(app, chat: chat));
      await sheetArrives(tester);
      await settle(tester);
    }

    chatTest('closing mid-conversation shrinks the chat to a bar that follows it',
        (tester) async {
      await openFromApp(tester);
      server.agentSays('msg_a', 'Your order is on its way');
      await settle(tester, 400);

      // Mid-conversation the close button is an arrow down: put down, not away.
      await tester.tap(find.byTooltip('Minimise'));
      await settle(tester, 400);
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byType(NestMessenger), findsNothing);
      expect(find.byType(NestMinimisedChat), findsOneWidget);
      expect(find.text('Your order is on its way'), findsOneWidget);

      // A reply while it is down arrives on the bar, counted.
      server.agentSays('msg_b', 'Should be with you in 10 minutes');
      await settle(tester, 400);
      expect(find.text('Should be with you in 10 minutes'), findsOneWidget);
      expect(
        find.descendant(of: find.byType(NestMinimisedChat), matching: find.text('1')),
        findsOneWidget,
      );

      // And tapping it is the conversation again, not the bar plus a sheet.
      await tester.tap(find.text('Should be with you in 10 minutes'));
      await sheetArrives(tester);
      await settle(tester);
      expect(find.byType(NestMinimisedChat), findsNothing);
      expect(find.byType(TextField), findsOneWidget);
      expect(chat.unread, 0);
    });

    /// Minimised mid-conversation, from an app with pages to go to.
    Future<BuildContext> minimiseFromApp(WidgetTester tester) async {
      late BuildContext app;
      await tester.pumpWidget(host(Builder(builder: (context) {
        app = context;
        return const SizedBox.expand();
      })));
      unawaited(showNestMessenger(app, chat: chat));
      await sheetArrives(tester);
      await settle(tester);
      server.agentSays('msg_a', 'Your order is on its way');
      await settle(tester, 400);
      await tester.tap(find.byTooltip('Minimise'));
      await settle(tester, 400);
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byType(NestMinimisedChat), findsOneWidget);
      return app;
    }

    chatTest('the bar stays on top as the app goes to another page', (tester) async {
      final app = await minimiseFromApp(tester);

      // The app's Home tab, pushed as a page. Pages are drawn in the same stack
      // as the bar, and a new one went on top of it — the bar was there, just
      // underneath, until the customer came back.
      // "Go home" — the whole stack replaced, the way a router's `go` does it.
      unawaited(Navigator.of(app).pushAndRemoveUntil(
        MaterialPageRoute<void>(
          builder: (_) => const Scaffold(body: Center(child: Text('Ding home'))),
        ),
        (_) => false,
      ));
      await tester.pumpAndSettle();

      expect(find.text('Ding home'), findsOneWidget);
      expect(find.byType(NestMinimisedChat), findsOneWidget);
      // Drawn and tappable, not merely somewhere in the tree.
      expect(find.text('Your order is on its way').hitTestable(), findsOneWidget);
    });

    chatTest('and through the app signing the customer in again', (tester) async {
      await minimiseFromApp(tester);

      // What an app's home page does when it loads: says who is signed in.
      // The session came down and back up, and the bar — seeing no chat for a
      // moment — took itself away for good.
      await tester.runAsync(() => chat.login(userId: 'u_1', name: 'Marta Nowak'));
      await settle(tester, 400);
      await settle(tester, 400);

      expect(find.byType(NestMinimisedChat), findsOneWidget);
    });

    chatTest('a chat with nothing said in it just closes', (tester) async {
      await openFromApp(tester);
      expect(find.byTooltip('Minimise'), findsNothing);
      await tester.tap(find.byTooltip('Close'));
      await settle(tester, 400);
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byType(NestMessenger), findsNothing);
      expect(find.byType(NestMinimisedChat), findsNothing);
    });

    chatTest('the bar can be put away', (tester) async {
      await openFromApp(tester);
      server.agentSays('msg_a', 'Your order is on its way');
      await settle(tester, 400);
      await tester.tap(find.byTooltip('Minimise'));
      await settle(tester, 400);
      await tester.pump(const Duration(milliseconds: 400));

      await tester.tap(find.byTooltip('Hide'));
      await tester.pump();
      await tester.pump();
      expect(find.byType(NestMinimisedChat), findsNothing);
    });

    chatTest('the launcher steps aside for the bar', (tester) async {
      await tester.pumpWidget(host(Stack(children: [
        Positioned(right: 16, bottom: 16, child: NestLauncher(chat: chat)),
      ])));
      await settle(tester);
      await tester.tap(find.byType(FloatingActionButton));
      await sheetArrives(tester);
      await settle(tester);
      server.agentSays('msg_a', 'Your order is on its way');
      await settle(tester, 400);
      await tester.tap(find.byTooltip('Minimise'));
      await settle(tester, 400);
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.byType(NestMinimisedChat), findsOneWidget);
      expect(find.byType(FloatingActionButton), findsNothing);

      await tester.tap(find.byTooltip('Hide'));
      await tester.pump();
      await tester.pump();
      expect(find.byType(FloatingActionButton), findsOneWidget);
    });
  });

  test('a minimised preview says what a message was, in one line', () {
    NestMessage msg(NestAuthor from, String body, [List<NestAttachment> files = const []]) =>
        NestMessage(id: 'm', from: from, body: body, at: DateTime(2026), attachments: files);
    expect(nestPreview(msg(NestAuthor.agent, 'Two\n\nlines')), 'Two lines');
    expect(nestPreview(msg(NestAuthor.visitor, 'Thanks!')), 'You: Thanks!');
  });

  chatTest('the greeting says the customer\'s name', (tester) async {
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

  chatTest('and the people who answer are shown', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    // Their own initials, not the first letter of their name — for the one who
    // has no photo. The one who does is a photo, which is the point of showing
    // faces at all, and is measured in its own test below.
    expect(find.text('PS'), findsOneWidget);
    expect(facePhoto(), findsOneWidget);
  });

  chatTest('no attach button when the app has no picker', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await tester.pump();
    // Better than a button that opens nothing.
    expect(find.byTooltip('Attach'), findsNothing);
  });

  chatTest('a picker gets a button, and tapping it asks the app', (tester) async {
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

  chatTest('a staged file can be taken back off', (tester) async {
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

  chatTest('the launcher badges what is waiting', (tester) async {
    await tester.pumpWidget(host(NestLauncher(chat: chat)));
    await settle(tester);
    expect(find.text('1'), findsNothing);

    server.agentSays('msg_a', 'hello?');
    await settle(tester, 500);
    expect(find.text('1'), findsOneWidget);
  });

  chatTest('the badge stops counting past nine', (tester) async {
    await tester.pumpWidget(host(NestLauncher(chat: chat)));
    await settle(tester);
    for (var i = 0; i < 12; i++) {
      server.agentSays('msg_$i', 'ping $i');
    }
    await settle(tester, 700);
    // Past nine it stops being a number worth reading.
    expect(find.text('9+'), findsOneWidget);
  });

  chatTest('the launcher opens the messenger', (tester) async {
    await tester.pumpWidget(host(Builder(
      builder: (context) => NestLauncher(chat: chat),
    )));
    await settle(tester);

    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();
    expect(find.text('Ding support'), findsOneWidget);
  });

  chatTest(
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

  chatTest('an agent typing shows as dots, which the reply replaces',
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

  chatTest('and stops believing it after a while with no word', (tester) async {
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

  chatTest('a face with a photo fills the circle that clips it',
      (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    final photo = facePhoto();
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
          'id': 'cv_live',
          'closed': false,
          'preview': 'Anything else I can help with?',
          'from': 'agent',
          'authorName': 'Priya',
          'at': DateTime.now().subtract(const Duration(minutes: 3)).toIso8601String(),
        },
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
      // A second window of real time. Opening the chat now tells the server it
      // is on screen, and that request and the history fetch both start on the
      // test's fake clock — the second only goes out once the first has.
      await settle(tester, 400);
      await tester.pump(const Duration(milliseconds: 400));
    }

    chatTest('a tapped notification opens on the conversation, not here', (tester) async {
      server.home = true;
      await tester.runAsync(() => chat.login(userId: 'u_1', name: 'Marta Nowak'));
      await settle(tester, 250);
      // The reply the notification was about, which arrived while the app slept.
      server.thread = [
        {
          'id': 'msg_late',
          'from': 'agent',
          'authorName': 'Nathan',
          'body': 'Your refund has gone through',
          'at': DateTime.now().toIso8601String(),
        },
      ];
      late BuildContext app;
      await tester.pumpWidget(host(Builder(builder: (context) {
        app = context;
        return const SizedBox.expand();
      })));

      // Somebody else's notification is left to the app.
      var opened = false;
      await tester.runAsync(() async {
        opened = await openNestNotification(app, chat: chat, data: {'source': 'shop'});
      });
      expect(opened, isFalse);

      await tester.runAsync(() async {
        opened = await openNestNotification(
          app,
          chat: chat,
          data: {'source': 'nestconnect', 'conversationId': 'cv_live'},
        );
      });
      await sheetArrives(tester);
      await settle(tester, 400);

      // Tapping "Nathan replied" used to land on the app's own screen, or at
      // best on the home cards: the reply itself was two taps away.
      expect(opened, isTrue);
      expect(find.text('Your refund has gone through'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Send us a message'), findsNothing);
    });

    chatTest('a waiting reply opens the chat on it, even from showNestMessenger', (tester) async {
      server.home = true;
      await tester.runAsync(() => chat.login(userId: 'u_1', name: 'Marta Nowak'));
      await settle(tester, 250);
      await settle(tester, 250);
      server.agentSays('msg_w', 'Your refund has gone through');
      await settle(tester, 300);
      expect(chat.unread, 1);

      late BuildContext app;
      await tester.pumpWidget(host(Builder(builder: (context) {
        app = context;
        return const SizedBox.expand();
      })));
      // What an app wired before openNestNotification existed does on a tap.
      unawaited(showNestMessenger(app, chat: chat));
      await sheetArrives(tester);
      await settle(tester, 400);

      expect(find.text('Your refund has gone through'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Send us a message'), findsNothing);
    });

    chatTest('is where the chat opens, when the business has one', (tester) async {
      await openHome(tester);

      // The channel's own words for its own front door.
      expect(find.text('Send us a message'), findsOneWidget);
      expect(find.text('Help centre'), findsOneWidget);
      // And no composer: nobody has chosen to write anything yet.
      expect(find.byType(TextField), findsNothing);
    });

    chatTest('and the chat card goes to the conversation', (tester) async {
      await openHome(tester);
      await tester.tap(find.text('Send us a message'));
      await settle(tester, 200);

      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Help centre'), findsNothing);
    });

    chatTest('an earlier conversation can be read, and not written to',
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

    chatTest('and leaving it comes back to the cards', (tester) async {
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

    chatTest('lists every conversation, open and closed, and says which',
        (tester) async {
      await openHome(tester);

      // The report: "need to be able to see the chat history, recent chats,
      // even closed, with a tag". A closed conversation used to leave this side
      // entirely, and the live one sat in the same list with nothing to tell
      // the two apart.
      expect(find.text('Your conversations'), findsOneWidget);
      expect(find.text('Open'), findsOneWidget);
      expect(find.text('Closed'), findsOneWidget);
      expect(find.text('Sorted — a replacement is on the way'), findsOneWidget);
      // And the live one leads, the way a messenger's home does.
      expect(find.text('Recent message'), findsOneWidget);
    });

    chatTest('shows the shape of the list while it loads, not a spinner',
        (tester) async {
      server.holdHistory = Completer<void>();
      await openHome(tester);

      expect(find.byType(NestConversationBone), findsWidgets);
      expect(find.byType(CircularProgressIndicator), findsNothing);

      server.holdHistory!.complete();
      await settle(tester, 400);
      await settle(tester, 400);
      expect(find.byType(NestConversationBone), findsNothing);
      expect(find.text('Closed'), findsOneWidget);
    });

    chatTest('a WhatsApp card carries the WhatsApp mark', (tester) async {
      await openHome(tester);

      // It carried a flame. Material has no WhatsApp glyph, so the
      // nearest-looking icon got used, on a card that said "WhatsApp".
      final marks = tester.widgetList<NestCardIcon>(find.byType(NestCardIcon));
      expect(marks.map((m) => m.name), contains('whatsapp'));
      expect(find.byIcon(Icons.whatshot_rounded), findsNothing);
    });

    chatTest('a card hands its link to the app', (tester) async {
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

  chatTest('the business\'s logo is in the header', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    // Sent root-relative, which is right for the web widget and useless in an
    // app. Read as it came, it was a path with no host and never loaded.
    final logo = tester
        .widgetList<Image>(find.byType(Image))
        .map((i) => i.image)
        .whereType<NetworkImage>()
        .map((i) => i.url)
        .where((u) => u.endsWith('/logo'));
    expect(logo, [ '${server.baseUrl}/api/nestchat/wk_1/logo' ]);
  });

  chatTest('the header\'s text is the colour the business chose', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    final title = tester.widget<Text>(find.text('Ding support'));
    expect(title.style?.color, const Color(0xFFFFFBE6));
  });

  group('with the keyboard up', () {
    /// Opens the real sheet on a phone-sized screen, raises a keyboard, and
    /// answers where the sheet's bottom edge ended up against the keyboard's
    /// top.
    ///
    /// [hostLifts] is the app the gap was reported from: its whole navigator is
    /// lifted clear of the keyboard — its tab bar sat on top of the keyboard in
    /// the screenshot — without taking the inset out of what it hands down. A
    /// messenger that also lifts by the full keyboard pays for it twice and
    /// floats a keyboard's height above it.
    Future<double> gapAboveKeyboard(WidgetTester tester, {required bool hostLifts}) async {
      tester.view.physicalSize = const Size(1170, 2532);
      tester.view.devicePixelRatio = 3;
      tester.view.padding = const FakeViewPadding(top: 141, bottom: 102);
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => hostLifts
              ? Padding(
                  padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
                  child: child,
                )
              : child!,
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

      // As a phone reports it: the keyboard's height as an inset, and the home
      // indicator's strip gone from the padding because the keyboard covers it.
      tester.view.viewInsets = const FakeViewPadding(bottom: 1008);
      tester.view.padding = const FakeViewPadding(top: 141);
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => hostLifts
              ? Padding(
                  padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
                  child: child,
                )
              : child!,
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
      // The clearance measures after a frame and applies on the next.
      for (var i = 0; i < 4; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }

      const keyboardTop = 2532 / 3 - 1008 / 3;
      final sheet = find.descendant(
        of: find.byType(NestKeyboardClearance),
        matching: find.byType(Container),
      );
      return keyboardTop - tester.getRect(sheet.first).bottom;
    }

    chatTest('the composer sits on the keyboard', (tester) async {
      final gap = await gapAboveKeyboard(tester, hostLifts: false);
      expect(gap.abs(), lessThan(1), reason: 'neither a gap nor an overlap: ${gap}pt');
    });

    chatTest('and still does in an app that lifts itself for the keyboard',
        (tester) async {
      // The report: the sheet "flies up" with a gap exactly one keyboard tall.
      final gap = await gapAboveKeyboard(tester, hostLifts: true);
      expect(gap.abs(), lessThan(1), reason: 'neither a gap nor an overlap: ${gap}pt');
    });
  });

  chatTest('with no home screen, the chat opens on the conversation',
      (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester, 400);
    await tester.pump(const Duration(milliseconds: 400));

    // The default, and the one every app shipped against: a front door is a tap
    // between somebody and the message box, and a business that answers on one
    // channel should not grow one because this feature was added.
    expect(find.byType(TextField), findsOneWidget);
  });

  chatTest('a voice note is a waveform, not a file listed under a bubble',
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

  chatTest('a reply shows what it answers, and says so', (tester) async {
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

  chatTest('an agent reacting puts the emoji on the message', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    server.agentSays('msg_a', 'On its way!');
    await settle(tester, 500);
    expect(find.text('\u2764\ufe0f'), findsNothing);

    server.agentReacts('msg_a', '\u2764\ufe0f');
    await settle(tester, 500);
    expect(find.text('\u2764\ufe0f'), findsOneWidget);
  });

  chatTest('swiping a message far enough offers to reply to it',
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

  chatTest('and the reply can be called off', (tester) async {
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

  chatTest('a closed chat can still be read, but not reacted to',
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

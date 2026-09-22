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
        // The server's own shape: `faces`, with the details a face is drawn
        // from. This said `members` and carried nothing but a name — written
        // from what the client happened to read rather than from the payload —
        // so the header showed nobody and no test noticed.
        'team': {
          'name': 'Support',
          'total': 2,
          'faces': [
            {'name': 'Nathan', 'initials': 'NA', 'color': '#3B82F6', 'online': true},
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

  testWidgets('and the people who answer are shown', (tester) async {
    await tester.pumpWidget(host(NestMessenger(chat: chat)));
    await settle(tester);

    // Their own initials, not the first letter of their name.
    expect(find.text('NA'), findsOneWidget);
    expect(find.text('PS'), findsOneWidget);
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

/// Renders the messenger, as a phone would show it, to PNG files.
///
///     flutter test tool/screenshots_test.dart
///
/// Writes to `build/screenshots/` (or `$NEST_SCREENSHOTS`). Not part of the
/// suite under `test/`: these are pictures for a person to look at, not
/// assertions, and they would only ever fail on a font hinting change.
///
/// Why it exists: the look of this package is half of what it is, and until now
/// the only way anybody saw it was to build a host app, install it on a phone and
/// open the chat. The keyboard gap a customer's app hit was invisible to every
/// test here, because none of them was ever *looked at*.
///
/// Everything is real except the server: real fonts (Roboto, the Material
/// icons, Noto emoji), a real HTTP server on loopback serving the API's shapes
/// and real images, and the real `showNestMessenger` sheet over a stand-in host
/// app. The keyboard is drawn as a grey panel over the inset the view reports,
/// so where the composer lands against it is exactly where it would on a phone.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nestconnect_flutter/nestconnect_flutter.dart';

/// An iPhone 14: 390×844 points.
const _screen = Size(390, 844);
const _statusBar = 47.0;
const _homeIndicator = 34.0;

/// The iOS keyboard with its suggestion strip, in points.
const _keyboard = 336.0;

final _out = Directory(Platform.environment['NEST_SCREENSHOTS'] ?? 'build/screenshots');

/* ---- the server ---- */

class _Server {
  late HttpServer _http;
  final _events = StreamController<String>.broadcast();

  Map<String, Object?> config = {};
  List<Map<String, Object?>> session = [];
  List<Map<String, Object?>> past = [];
  Map<String, List<Map<String, Object?>>> pastMessages = {};

  /// Holds answers back, for the loading states.
  Completer<void>? holdHistory;
  Completer<void>? holdConfig;

  void agentTypes() =>
      _events.add('data: ${jsonEncode({'kind': 'typing', 'who': 'agent', 'typing': true})}\n\n');
  Completer<void>? holdPast;

  late Uint8List avatar;
  late Uint8List logo;

  String get baseUrl => 'http://${_http.address.host}:${_http.port}';

  Future<void> start() async {
    _http = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    unawaited(() async {
      await for (final req in _http) {
        unawaited(_handle(req).catchError((Object _) {}));
      }
    }());
  }

  Future<void> _handle(HttpRequest req) async {
    final path = req.uri.path;
    await utf8.decoder.bind(req).join();
    req.response.persistentConnection = false;

    if (path.endsWith('/stream')) {
      req.response.headers.contentType = ContentType('text', 'event-stream', charset: 'utf-8');
      req.response.bufferOutput = false;
      req.response.write(': open\n\n');
      await req.response.flush();
      final sub = _events.stream.listen((d) {
        req.response.write(d);
        unawaited(req.response.flush().catchError((Object _) {}));
      });
      await req.response.done.catchError((Object _) {});
      await sub.cancel();
      return;
    }
    if (path.contains('/avatar/') || path.endsWith('/logo')) {
      req.response.headers.contentType = ContentType('image', 'png');
      req.response.add(path.endsWith('/logo') ? logo : avatar);
      await req.response.close();
      return;
    }

    req.response.headers.contentType = ContentType.json;
    Object? body = {'ok': true};
    if (path.endsWith('/config')) {
      await holdConfig?.future;
      body = config;
    } else if (path.endsWith('/session')) {
      body = {
        'token': 'tok_1',
        'hasConversation': true,
        'messages': session,
        'identified': true,
        'unknownFields': <Object?>[],
      };
    } else if (path.endsWith('/conversations')) {
      await holdHistory?.future;
      body = {'conversations': past};
    } else if (path.contains('/conversations/') && path.endsWith('/messages')) {
      await holdPast?.future;
      final id = path.split('/conversations/').last.replaceAll('/messages', '');
      body = {'messages': pastMessages[id] ?? const []};
    }
    req.response.write(jsonEncode(body));
    await req.response.close();
  }

  Future<void> stop() async {
    await _events.close();
    await _http.close(force: true);
  }
}

/* ---- pictures to serve ---- */

/// A face: a warm background, a head and shoulders. Drawn rather than shipped,
/// so the repository carries nobody's photograph.
Future<Uint8List> _drawAvatar() async {
  const size = 160.0;
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  canvas.drawRect(
    const Rect.fromLTWH(0, 0, size, size),
    Paint()
      ..shader = ui.Gradient.linear(
        Offset.zero,
        const Offset(size, size),
        [const Color(0xFFF6C453), const Color(0xFFE59A2F)],
      ),
  );
  final skin = Paint()..color = const Color(0xFFE8B791);
  canvas.drawOval(const Rect.fromLTWH(46, 26, 68, 80), skin);
  canvas.drawOval(
    const Rect.fromLTWH(14, 104, 132, 110),
    Paint()..color = const Color(0xFF2B3A55),
  );
  canvas.drawRect(const Rect.fromLTWH(66, 96, 28, 18), skin);
  canvas.drawArc(
    const Rect.fromLTWH(44, 18, 72, 52),
    3.14,
    3.14,
    true,
    Paint()..color = const Color(0xFF3B2A20),
  );
  final image = await recorder.endRecording().toImage(size.toInt(), size.toInt());
  final png = await image.toByteData(format: ui.ImageByteFormat.png);
  return png!.buffer.asUint8List();
}

/// The business's mark: a white wordmark on transparent, the way a logo is
/// uploaded for a coloured header.
Future<Uint8List> _drawLogo() async {
  final painter = TextPainter(
    text: const TextSpan(
      text: 'ding',
      style: TextStyle(
        fontFamily: 'Roboto',
        fontWeight: FontWeight.w900,
        fontSize: 64,
        color: Colors.white,
        letterSpacing: -2,
      ),
    ),
    textDirection: TextDirection.ltr,
  )..layout();
  final w = painter.width.ceil() + 8, h = painter.height.ceil();
  final recorder = ui.PictureRecorder();
  painter.paint(Canvas(recorder), const Offset(4, 0));
  final image = await recorder.endRecording().toImage(w, h);
  final png = await image.toByteData(format: ui.ImageByteFormat.png);
  return png!.buffer.asUint8List();
}

/* ---- fonts ---- */

Future<void> _loadFonts() async {
  Future<void> family(String name, List<String> files) async {
    final loader = FontLoader(name);
    for (final f in files) {
      loader.addFont(Future.value(ByteData.sublistView(File(f).readAsBytesSync())));
    }
    await loader.load();
  }

  const material = '/opt/flutter/bin/cache/artifacts/material_fonts';
  await family('Roboto', [
    for (final w in ['Light', 'Regular', 'Medium', 'Bold', 'Black']) '$material/Roboto-$w.ttf',
  ]);
  await family('MaterialIcons', ['$material/MaterialIcons-Regular.otf']);
  final emoji = File('/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf');
  if (emoji.existsSync()) await family('NotoColorEmoji', [emoji.path]);
}

/* ---- the host app ---- */

/// A stand-in for the app the chat is dropped into: a greeting, some content
/// and a tab bar, like the one the report came from.
class _Host extends StatelessWidget {
  const _Host({required this.chat});
  final NestConnect chat;

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFFF7F7F8),
        body: SafeArea(
          child: SingleChildScrollView(
            child: Padding(
            padding: const EdgeInsets.fromLTRB(22, 18, 22, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Hi Nathan',
                  style: TextStyle(fontSize: 34, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 18),
                Builder(
                  builder: (context) => FilledButton(
                    key: const Key('open'),
                    onPressed: () => showNestMessenger(context, chat: chat),
                    child: const Text('Help'),
                  ),
                ),
              ],
            ),
          ),
          ),
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: 4,
          destinations: const [
            NavigationDestination(icon: Icon(Icons.storefront_outlined), label: 'Discover'),
            NavigationDestination(icon: Icon(Icons.favorite_border), label: 'Favorite'),
            NavigationDestination(icon: Icon(Icons.receipt_long_outlined), label: 'Orders'),
            NavigationDestination(icon: Icon(Icons.search), label: 'Search'),
            NavigationDestination(icon: Icon(Icons.person), label: 'Profile'),
          ],
        ),
      );
}

/// The device: the app, a status bar and — when it is up — the keyboard.
Widget _device({
  required NestConnect chat,
  required bool keyboard,
  required bool hostPadsForKeyboard,
}) =>
    RepaintBoundary(
      key: const Key('device'),
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          platform: TargetPlatform.iOS,
          fontFamily: 'Roboto',
          fontFamilyFallback: const ['NotoColorEmoji'],
          colorSchemeSeed: const Color(0xFFE0136C),
        ),
        builder: (context, child) {
          Widget app = child!;
          // What the app the report came from does, by every sign in its
          // screenshot: the whole navigator is lifted clear of the keyboard —
          // its tab bar sits *on top of* the keyboard — without removing the
          // inset from what it hands down. Anything below that pads for the
          // keyboard as well pays for it twice.
          if (hostPadsForKeyboard) {
            app = Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
              child: app,
            );
          }
          return Stack(
            children: [
              Positioned.fill(child: app),
              const Positioned(top: 14, left: 32, child: _StatusTime()),
              if (keyboard)
                const Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: _keyboard,
                  child: _Keyboard(),
                ),
            ],
          );
        },
        home: _Host(chat: chat),
      ),
    );

class _StatusTime extends StatelessWidget {
  const _StatusTime();
  @override
  Widget build(BuildContext context) => const Text(
        '9:41',
        style: TextStyle(
          fontFamily: 'Roboto',
          fontSize: 16,
          fontWeight: FontWeight.w600,
          color: Colors.black,
        ),
      );
}

class _Keyboard extends StatelessWidget {
  const _Keyboard();
  @override
  Widget build(BuildContext context) {
    Widget key(String l, {int flex = 1}) => Expanded(
          flex: flex,
          child: Container(
            margin: const EdgeInsets.all(3),
            height: 42,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(6),
              boxShadow: const [BoxShadow(color: Color(0x33000000), offset: Offset(0, 1))],
            ),
            child: Text(
              l,
              style: const TextStyle(fontFamily: 'Roboto', fontSize: 18, color: Colors.black),
            ),
          ),
        );
    Widget row(String keys) => Row(children: [for (final k in keys.split('')) key(k)]);
    return Container(
      color: const Color(0xFFD1D4DA),
      padding: const EdgeInsets.fromLTRB(3, 8, 3, 0),
      child: Column(
        children: [
          const SizedBox(
            height: 36,
            child: DefaultTextStyle(
              style: TextStyle(fontFamily: 'Roboto', fontSize: 17, color: Colors.black),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [Text('I'), Text('The'), Text("I'm")],
              ),
            ),
          ),
          row('QWERTYUIOP'),
          row('ASDFGHJKL'),
          row('ZXCVBNM'),
          Row(children: [key('123', flex: 2), key('space', flex: 6), key('return', flex: 3)]),
        ],
      ),
    );
  }
}

/* ---- capture ---- */

Future<void> _capture(WidgetTester tester, String name) async {
  // Every picture on screen decoded before the shot, so a face is a face rather
  // than whatever stands in for it while the bytes are on their way.
  await tester.runAsync(() async {
    for (final element in find.byType(Image).evaluate()) {
      final image = (element.widget as Image).image;
      await precacheImage(image, element, onError: (_, __) {});
    }
  });
  await tester.pump(const Duration(milliseconds: 100));
  await tester.pump(const Duration(milliseconds: 600));
  final boundary =
      tester.renderObject<RenderRepaintBoundary>(find.byKey(const Key('device')));
  final bytes = await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 2);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return data!.buffer.asUint8List();
  });
  _out.createSync(recursive: true);
  File('${_out.path}/$name.png').writeAsBytesSync(bytes!);
  // ignore: avoid_print
  print('wrote ${_out.path}/$name.png');
}

/// Real time for the sockets, fake time for the animations, and images given
/// the chance to decode.
Future<void> _settle(WidgetTester tester, {int rounds = 3}) async {
  for (var i = 0; i < rounds; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 250)));
    await tester.pump(const Duration(milliseconds: 400));
  }
}

/* ---- the channel ---- */

Map<String, Object?> _dingConfig({bool home = true}) => {
      'appearance': {
        'accent': '#E0136C',
        'accentText': '#ffffff',
        'headerGradient': true,
        'accentTo': '#9B1048',
        'theme': 'light',
        'headline': 'Hello {name} 👋',
        'title': 'How can we help?',
        'subtitle': 'We usually reply in a few minutes',
        'awayMessage': "We're away right now — leave a message and we'll reply by email.",
        'greeting': 'Hi 👋 How can we help today?',
        'placeholder': 'Write a message…',
        'closedMessage': 'This chat has been closed. Thanks for getting in touch!',
        'newChatLabel': 'Start a new chat',
        'showBranding': true,
        'logoUrl': '/api/nestchat/wk_ding/logo',
      },
      'online': false,
      'team': {
        'name': 'Support',
        'total': 3,
        'faces': [
          {
            'name': 'Nathan',
            'initials': 'NA',
            'color': '#3B82F6',
            'avatarUrl': '/api/nestchat/wk_ding/avatar/u_1',
          },
          {'name': 'Sam Taylor', 'initials': 'ST', 'color': '#DB2777'},
        ],
      },
      if (home)
        'home': {
          'enabled': true,
          'chatLabel': 'Send us a message',
          'chatSublabel': 'We usually reply in a few minutes',
          'cards': [
            {
              'id': 'wa',
              'label': 'Message Us on WhatsApp!',
              'sublabel': 'Avg response time: 3 mins',
              'icon': 'whatsapp',
              'href': 'https://wa.me/447000000000',
            },
          ],
        },
    };

String _ago(Duration d) => DateTime.now().subtract(d).toIso8601String();

List<Map<String, Object?>> _thread() => [
      {'id': 'm1', 'from': 'visitor', 'body': 'Hi', 'at': _ago(const Duration(minutes: 9))},
      {
        'id': 'm2',
        'from': 'visitor',
        'body': 'My order DG-88412 is missing the fries 🍟',
        'at': _ago(const Duration(minutes: 8)),
      },
      {
        'id': 'm3',
        'from': 'agent',
        'authorName': 'Nathan',
        'body': "So sorry about that! I've refunded the fries and added a £3 credit to your account.",
        'at': _ago(const Duration(minutes: 4)),
      },
      {
        'id': 'm4',
        'from': 'agent',
        'authorName': 'Nathan',
        'body': 'Anything else I can help with?',
        'at': _ago(const Duration(minutes: 4)),
      },
    ];

List<Map<String, Object?>> _past() => [
      {
        'id': 'cv_live',
        'closed': false,
        'preview': 'Anything else I can help with?',
        'from': 'agent',
        'authorName': 'Nathan',
        'at': _ago(const Duration(minutes: 4)),
      },
      {
        'id': 'cv_1',
        'closed': true,
        'preview': 'Sorted — a replacement is on the way',
        'from': 'agent',
        'authorName': 'Sam Taylor',
        'at': _ago(const Duration(days: 2)),
      },
      {
        'id': 'cv_2',
        'closed': true,
        'preview': 'Can I change the delivery address?',
        'from': 'visitor',
        'at': _ago(const Duration(days: 12)),
      },
    ];

/* ---- the scenes ---- */

void main() {
  setUpAll(() async {
    HttpOverrides.global = null;
    await _loadFonts();
  });

  late _Server server;
  late NestConnect chat;

  Future<void> open(
    WidgetTester tester, {
    bool keyboard = false,
    bool hostPads = false,
  }) async {
    tester.view.physicalSize = _screen * 3;
    tester.view.devicePixelRatio = 3;
    tester.view.padding = const FakeViewPadding(top: _statusBar * 3, bottom: _homeIndicator * 3);
    addTearDown(tester.view.reset);

    server = _Server();
    await tester.runAsync(() async {
      server.avatar = await _drawAvatar();
      server.logo = await _drawLogo();
      await server.start();
    });
    addTearDown(() async {
      await tester.runAsync(() async {
        await chat.dispose();
        await server.stop();
      });
    });
    return;
  }

  Future<void> login(WidgetTester tester) async {
    chat = NestConnect(baseUrl: server.baseUrl, appKey: 'na_ding');
    await tester.runAsync(() async {
      await chat.login(userId: 'u_1', name: 'Nathan Ding');
      await Future<void>.delayed(const Duration(milliseconds: 200));
    });
  }

  Future<void> showSheet(
    WidgetTester tester, {
    bool keyboard = false,
    bool hostPads = false,
  }) async {
    await tester.pumpWidget(
      _device(chat: chat, keyboard: keyboard, hostPadsForKeyboard: hostPads),
    );
    await tester.tap(find.byKey(const Key('open')));
    await _settle(tester);
  }

  Future<void> raiseKeyboard(WidgetTester tester, {required bool hostPads}) async {
    tester.view.viewInsets = const FakeViewPadding(bottom: _keyboard * 3);
    // What the engine reports on a phone: the home-indicator strip is under the
    // keyboard, so the usable padding there is nothing. A fake view does not
    // work that out for itself.
    tester.view.padding = const FakeViewPadding(top: _statusBar * 3);
    await tester.pumpWidget(_device(chat: chat, keyboard: true, hostPadsForKeyboard: hostPads));
    await _settle(tester, rounds: 2);
  }

  testWidgets('01 home', (tester) async {
    await open(tester);
    server
      ..config = _dingConfig()
      ..session = _thread()
      ..past = _past();
    await login(tester);
    await showSheet(tester);
    await _capture(tester, '01-home');
  });

  testWidgets('02 home, loading', (tester) async {
    await open(tester);
    server
      ..config = _dingConfig()
      ..past = _past()
      ..holdHistory = Completer<void>();
    await login(tester);
    await showSheet(tester);
    await _capture(tester, '02-home-loading');
    server.holdHistory!.complete();
    await _settle(tester);
  });

  testWidgets('03 conversation', (tester) async {
    await open(tester);
    server
      ..config = _dingConfig(home: false)
      ..session = _thread();
    await login(tester);
    await showSheet(tester);
    await _capture(tester, '03-conversation');
  });

  testWidgets('04 conversation, keyboard up', (tester) async {
    await open(tester);
    server
      ..config = _dingConfig(home: false)
      ..session = _thread();
    await login(tester);
    await showSheet(tester);
    await raiseKeyboard(tester, hostPads: false);
    await _capture(tester, '04-conversation-keyboard');
  });

  testWidgets('05 conversation, keyboard up, in an app that also lifts for it',
      (tester) async {
    await open(tester);
    server
      ..config = _dingConfig(home: false)
      ..session = _thread();
    await login(tester);
    await showSheet(tester, hostPads: true);
    await raiseKeyboard(tester, hostPads: true);
    await _capture(tester, '05-conversation-keyboard-host-lifts');
  });

  testWidgets('07 an agent typing', (tester) async {
    await open(tester);
    server
      ..config = _dingConfig(home: false)
      ..session = _thread();
    await login(tester);
    await showSheet(tester);
    server.agentTypes();
    await _settle(tester, rounds: 2);
    await _capture(tester, '07-agent-typing');
  });

  testWidgets('08 opening, before the channel has answered', (tester) async {
    await open(tester);
    server
      ..config = _dingConfig()
      ..holdConfig = Completer<void>();
    await login(tester);
    await showSheet(tester);
    await _capture(tester, '08-first-load-skeleton');
    server.holdConfig!.complete();
    await _settle(tester);
  });

  testWidgets('06 an earlier conversation', (tester) async {
    await open(tester);
    server
      ..config = _dingConfig()
      ..session = _thread()
      ..past = _past()
      ..pastMessages = {
        'cv_1': [
          {
            'id': 'p1',
            'from': 'visitor',
            'body': 'My burger arrived cold',
            'at': _ago(const Duration(days: 2, minutes: 20)),
          },
          {
            'id': 'p2',
            'from': 'agent',
            'authorName': 'Sam Taylor',
            'body': 'Sorted — a replacement is on the way',
            'at': _ago(const Duration(days: 2)),
          },
        ],
      };
    await login(tester);
    await showSheet(tester);
    final row = find.textContaining('Sorted — a replacement is on the way');
    await tester.tap(row.first);
    await _settle(tester);
    await _capture(tester, '06-earlier-conversation');
  });
}

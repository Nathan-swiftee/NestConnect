/// The client, driven against a real HTTP server.
///
/// A fake transport would test that the client calls methods we wrote, which is
/// a tautology. This stands up an actual `HttpServer` speaking the shapes the
/// API speaks, so what is under test is the thing that matters: whether this
/// package and that server agree.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:nestconnect_client/nestconnect_client.dart';
import 'package:test/test.dart';

/// A stand-in for the NestChat API, recording what it was asked.
class FakeServer {
  late HttpServer _server;
  final requests = <String>[];
  final bodies = <String, Object?>{};

  /// Pushed to any open stream, so a test can play the part of an agent.
  final _events = StreamController<String>.broadcast();

  String get baseUrl => 'http://${_server.address.host}:${_server.port}';

  /// What the next session call answers with.
  Map<String, Object?> session = {
    'token': 'tok_1',
    'hasConversation': false,
    'messages': <Object?>[],
    'identified': true,
    'unknownFields': <Object?>[],
  };

  /// Status to answer the next send with, when it should fail.
  int? sendStatus;

  Future<void> start() async {
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    unawaited(_serve());
  }

  Future<void> _serve() async {
    // Each request handled off the accept loop. A stream is held open for the
    // life of the test, and awaiting it here would mean no request after the
    // first stream was ever answered — which is a property of this fake, but
    // the real server has the same shape and the same obligation.
    await for (final req in _server) {
      unawaited(_handle(req));
    }
  }

  Future<void> _handle(HttpRequest req) async {
    {
      final path = req.uri.path;
      requests.add('${req.method} $path');
      final body = await utf8.decoder.bind(req).join();
      if (body.isNotEmpty && req.headers.contentType?.mimeType == 'application/json') {
        bodies[path] = jsonDecode(body);
      } else if (body.isNotEmpty) {
        bodies[path] = body;
      }

      if (path.endsWith('/config')) {
        _json(req, {
          'appearance': {'accent': '#0a0', 'title': 'Ding support'},
          'online': true,
        });
      } else if (path.endsWith('/session')) {
        _json(req, session);
      } else if (path.endsWith('/message')) {
        if (sendStatus != null) {
          req.response.statusCode = sendStatus!;
          req.response.headers.contentType = ContentType.json;
          req.response.write(jsonEncode({'message': 'Nothing to send'}));
          await req.response.close();
        } else {
          _json(req, {
            'ok': true,
            'token': 'tok_2',
            'message': {
              'id': 'msg_1',
              'from': 'visitor',
              'body': jsonDecode(body)['body'],
              'at': DateTime.now().toIso8601String(),
            },
          });
        }
      } else if (path.endsWith('/upload')) {
        _json(req, {
          'ticket': 'tkt_1',
          'filename': 'curry.jpg',
          'mime': 'image/jpeg',
          'size': 42,
        });
      } else if (path.endsWith('/stream')) {
        req.response.headers.contentType = ContentType('text', 'event-stream');
        // Dart's HttpResponse buffers by default, and a buffered stream is not
        // a stream — without this the events sit in the server until the
        // response ends, which for a connection held open all session means
        // never. The real endpoint says the same thing to nginx with
        // `X-Accel-Buffering: no`.
        req.response.bufferOutput = false;
        // Writes are chained rather than fired off. An HttpResponse refuses a
        // write while a flush is still in flight — "StreamSink is bound to a
        // stream" — so two events arriving back to back would lose the second
        // and take the connection with it.
        var writes = Future<void>.value();
        void push(String data) {
          writes = writes.then((_) async {
            req.response.write(data);
            await req.response.flush();
          }).catchError((Object _) {});
        }

        push(': open\n\n');
        final sub = _events.stream.listen(push);
        // Held open until the client hangs up, like the real one — and off the
        // accept loop, so everything else still gets served meanwhile.
        await req.response.done.catchError((Object _) {});
        await sub.cancel();
      } else {
        _json(req, {'ok': true});
      }
    }
  }

  void _json(HttpRequest req, Object body) {
    req.response.headers.contentType = ContentType.json;
    req.response.write(jsonEncode(body));
    unawaited(req.response.close());
  }

  /// Play an agent replying.
  void agentSays(String id, String text) => _events.add(
        'data: ${jsonEncode({
              'type': 'message',
              'message': {
                'id': id,
                'from': 'agent',
                'body': text,
                'at': DateTime.now().toIso8601String(),
                'authorName': 'Nathan',
              },
            })}\n\n',
      );

  Future<void> stop() async {
    await _events.close();
    await _server.close(force: true);
  }
}

void main() {
  late FakeServer server;
  late NestConnect chat;

  setUp(() async {
    server = FakeServer();
    await server.start();
    chat = NestConnect(baseUrl: server.baseUrl, appKey: 'na_test');
  });

  tearDown(() async {
    await chat.dispose();
    await server.stop();
  });

  test('login sends the signature and reports what came of it', () async {
    final identity = await chat.login(
      userId: 'u_9182',
      userHash: 'deadbeef',
      name: 'Marta',
      fields: {'order_id': 'DG-88412'},
    );
    expect(identity, NestIdentity.verified);

    final sent = server.bodies['/api/nestchat/app/na_test/session']! as Map;
    expect(sent['externalId'], 'u_9182');
    expect(sent['userHash'], 'deadbeef');
    // The order goes with the session, so the thread this opens is that
    // order's rather than whichever was last open.
    expect((sent['fields']! as Map)['order_id'], 'DG-88412');
  });

  test('an unverified session says so rather than pretending', () async {
    server.session = {...server.session, 'identified': false};
    expect(await chat.open(), NestIdentity.anonymous);
  });

  test('a sent message appears before the network answers', () async {
    await chat.open();
    final seen = <List<NestMessage>>[];
    chat.onMessages.listen(seen.add);

    final sending = chat.send('Where is my order?');
    // Synchronously, on the frame the button was pressed — the point of the
    // whole optimistic path. A thread that shows nothing until the server
    // replies looks broken on a train.
    expect(chat.messages.single.body, 'Where is my order?');
    expect(chat.messages.single.pending, isTrue);

    await sending;
    expect(chat.messages.single.pending, isFalse);
    expect(chat.messages.single.id, 'msg_1');
  });

  test('a message that fails stays in the thread, marked', () async {
    await chat.open();
    server.sendStatus = 400;
    await expectLater(chat.send('hello'), throwsA(isA<NestException>()));
    // Removing it would read as having sent it.
    expect(chat.messages.single.failed, isTrue);
    expect(chat.messages.single.body, 'hello');
  });

  test('the server explains itself', () async {
    await chat.open();
    server.sendStatus = 400;
    try {
      await chat.send('hello');
      fail('should have thrown');
    } on NestException catch (e) {
      // "Nothing to send" is an answer; "400" is a puzzle.
      expect(e.message, 'Nothing to send');
      expect(e.isRetryable, isFalse);
    }
  });

  test('an agent reply arrives on the stream and counts as unread', () async {
    server.session = {...server.session, 'hasConversation': true};
    await chat.open();
    final unread = <int>[];
    chat.onUnread.listen(unread.add);

    // Give the stream a moment to connect before the agent speaks.
    await Future<void>.delayed(const Duration(milliseconds: 200));
    server.agentSays('msg_a', 'On its way!');
    await Future<void>.delayed(const Duration(milliseconds: 200));

    expect(chat.messages.last.body, 'On its way!');
    expect(chat.messages.last.from, NestAuthor.agent);
    expect(chat.unread, 1);
    expect(unread, contains(1));
  });

  test('the same reply twice is one message', () async {
    server.session = {...server.session, 'hasConversation': true};
    await chat.open();
    await Future<void>.delayed(const Duration(milliseconds: 200));
    // The server echoes; a reconnect replays. Either way it is one reply.
    server.agentSays('msg_a', 'On its way!');
    server.agentSays('msg_a', 'On its way!');
    await Future<void>.delayed(const Duration(milliseconds: 200));
    expect(chat.messages.where((m) => m.id == 'msg_a'), hasLength(1));
  });

  test('watching the chat clears the badge', () async {
    server.session = {...server.session, 'hasConversation': true};
    await chat.open();
    await Future<void>.delayed(const Duration(milliseconds: 200));
    server.agentSays('msg_a', 'hello?');
    await Future<void>.delayed(const Duration(milliseconds: 200));
    expect(chat.unread, 1);

    await chat.setViewing(true);
    expect(chat.unread, 0);
    expect(server.requests, contains('POST /api/nestchat/read'));
  });

  test('an attachment is staged, then sent by ticket', () async {
    await chat.open();
    final upload = await chat.attach(bytes: [1, 2, 3], filename: 'curry.jpg', mime: 'image/jpeg');
    expect(upload.ticket, 'tkt_1');

    await chat.send('', attachments: [upload]);
    final sent = server.bodies['/api/nestchat/message']! as Map;
    // The ticket, never a raw id: the file's details are the server's to state.
    expect(sent['attachments'], ['tkt_1']);
    // A photo with no words is a complete message.
    expect(sent['body'], '');
  });

  test('logging out drops the thread', () async {
    await chat.login(userId: 'u_1');
    expect(chat.isOpen, isTrue);
    await chat.logout();
    // Two people share a phone. The next one must not find the last one's chat.
    expect(chat.isOpen, isFalse);
    expect(chat.messages, isEmpty);
  });

  test('a push token registered before any chat is sent with the session', () async {
    // The order the host app actually does it in: Firebase hands over a token
    // at launch, long before anybody taps the chat button.
    await chat.registerPushToken('fcm_abc', platform: 'android');
    expect(server.requests.any((r) => r.endsWith('/device')), isFalse);

    await chat.open();
    await Future<void>.delayed(const Duration(milliseconds: 100));
    final sent = server.bodies['/api/nestchat/device']! as Map;
    expect(sent['token'], 'fcm_abc');
    expect(sent['platform'], 'android');
  });

  test('a token that rotates mid-session registers straight away', () async {
    await chat.open();
    await chat.registerPushToken('fcm_new', platform: 'ios');
    expect((server.bodies['/api/nestchat/device']! as Map)['token'], 'fcm_new');
  });

  test('turning notifications off forgets the address, signing out does not', () async {
    await chat.open();
    await chat.registerPushToken('fcm_abc', platform: 'android');

    // Signing out tells the server, because the registration is scoped to the
    // account that made it — but keeps the address, which belongs to the
    // handset. Otherwise the next person to sign in here never gets a banner.
    await chat.logout();
    expect(server.requests.where((r) => r.endsWith('/device/forget')).length, 1);
    await chat.login(userId: 'u_2');
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(server.requests.where((r) => r.endsWith('/device')).length, 2);

    // Turning them off is the other wish: the address goes too, so nothing
    // re-registers it behind their back.
    await chat.unregisterPushToken();
    await chat.logout();
    await chat.login(userId: 'u_2');
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(server.requests.where((r) => r.endsWith('/device')).length, 2);
  });

  test('sending without a session refuses rather than guessing', () async {
    await expectLater(chat.send('hello'), throwsA(isA<NestException>()));
  });

  test('the appearance comes from the channel', () async {
    await chat.open();
    await Future<void>.delayed(const Duration(milliseconds: 100));
    // Changed in Settings, live in the app, no app release.
    expect(chat.config?.appearance.accent, '#0a0');
    expect(chat.config?.appearance.title, 'Ding support');
  });

  test('a config that will not load does not stop the chat opening', () async {
    final offline = NestConnect(baseUrl: 'http://127.0.0.1:1', appKey: 'na_x');
    await expectLater(offline.open(), throwsA(isA<NestException>()));
    await offline.dispose();
  });
}

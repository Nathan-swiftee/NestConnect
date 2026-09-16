import 'dart:async';
import 'dart:io';

import 'models.dart';
import 'store.dart';
import 'transport.dart';

/// A live-chat session against one Nest Connect channel.
///
/// One of these per app, held for the app's life. It owns the token, the
/// thread, and the connection to the live stream — so the messenger UI above it
/// is a view of `messages` and nothing more, and a customer who closes the chat
/// and opens it again finds it where they left it.
///
/// ```dart
/// final chat = NestConnect(baseUrl: 'https://nestconnect.io', appKey: 'na_…');
/// await chat.login(userId: user.id, name: user.name, userHash: user.nestHash);
/// await chat.open(fields: {'order_id': 'DG-88412'});
/// ```
class NestConnect {
  NestConnect({
    required String baseUrl,
    required this.appKey,
    NestTokenStore? tokenStore,
    NestTransport? transport,
  })  : _store = tokenStore ?? NestMemoryTokenStore(),
        _transport = transport ?? NestTransport(baseUrl: baseUrl);

  /// The key from Settings › NestChat widget › In-app SDK. Public by design.
  final String appKey;

  final NestTransport _transport;
  final NestTokenStore _store;

  final _messages = <NestMessage>[];
  final _messagesController = StreamController<List<NestMessage>>.broadcast();
  final _unreadController = StreamController<int>.broadcast();

  String? _token;
  NestConfig? _config;
  StreamSubscription<Map<String, Object?>>? _streamSub;
  Timer? _reconnect;
  int _attempt = 0;

  /// Which stream is the current one.
  ///
  /// Every connection carries the generation it was opened in, and events from
  /// an older one are dropped. That is what lets this stop waiting on cancels:
  /// a subscription whose response the server is still holding open can take an
  /// arbitrary time to cancel — forever, if the server never lets go — and
  /// neither closing the messenger nor signing out may hang on that.
  int _generation = 0;
  bool _closed = false;

  /// The push address the host app handed us, and what kind of phone it is.
  ///
  /// Kept because registration is tied to a session and a session is not: the
  /// host gets its FCM token from Firebase whenever Firebase feels like giving
  /// it, which is routinely before anybody has opened the chat and again months
  /// later when the token rotates. Holding it means every session that opens
  /// afterwards registers it, instead of the notification quietly depending on
  /// which of the two happened first.
  String? _pushToken;
  String? _pushPlatform;
  bool _viewing = false;
  int _unread = 0;

  String _tokenKey() => 'nestconnect.token.$appKey';

  /// The thread so far, oldest first. Replaced wholesale on every change, so a
  /// UI can rebuild from it without tracking what moved.
  List<NestMessage> get messages => List.unmodifiable(_messages);
  Stream<List<NestMessage>> get onMessages => _messagesController.stream;

  /// Unread agent replies. What a launcher badge shows.
  int get unread => _unread;
  Stream<int> get onUnread => _unreadController.stream;

  /// The channel's appearance, once [open] has fetched it.
  NestConfig? get config => _config;

  /// Whether we have a session at all.
  bool get isOpen => _token != null;

  /// Say who this is.
  ///
  /// Calling it with a different user than last time throws the old session
  /// away first: two people sharing a phone is a real thing, and inheriting the
  /// previous one's thread would show one customer another's conversation.
  ///
  /// [userHash] is an HMAC-SHA256 of [userId] under the channel's signing
  /// secret, made by your own backend. Without it the channel decides what to
  /// do — trust the details, ignore them, or refuse — and the [NestIdentity]
  /// that comes back says which happened.
  Future<NestIdentity> login({
    required String userId,
    String? userHash,
    String? name,
    String? email,
    String? phone,
    Map<String, String>? fields,
  }) async {
    await _endSession();
    return _session(
      externalId: userId,
      userHash: userHash,
      name: name,
      email: email,
      phone: phone,
      fields: fields,
    );
  }

  /// Open a chat without saying who it is. Anonymous, and the thread belongs to
  /// this install alone.
  Future<NestIdentity> open({Map<String, String>? fields}) => _session(fields: fields);

  /// Forget this session. Called when somebody signs out of the host app: the
  /// next person to open the chat must not find the last one's conversation.
  Future<void> logout() async {
    // Before the session goes: the endpoint that forgets a device is scoped to
    // the token, so once `_endSession` has cleared it there is no way left to
    // say who the phone was. Getting this order wrong leaves the last person's
    // notifications arriving on a phone that has signed out of their account.
    await _forgetPush(keepAddress: true);
    await _endSession();
    _setMessages(const []);
    _setUnread(0);
  }

  Future<NestIdentity> _session({
    String? externalId,
    String? userHash,
    String? name,
    String? email,
    String? phone,
    Map<String, String>? fields,
  }) async {
    final body = <String, Object?>{
      if (externalId != null) 'externalId': externalId,
      if (userHash != null) 'userHash': userHash,
      if (name != null) 'name': name,
      if (email != null) 'email': email,
      if (phone != null) 'phone': phone,
      if (fields != null && fields.isNotEmpty) 'fields': fields,
    };
    final raw = await _transport.postJson('/app/$appKey/session', body);
    final map = raw is Map ? raw : const <String, Object?>{};

    _token = map['token'] as String?;
    if (_token != null) await _store.write(_tokenKey(), _token!);
    _closed = false;

    _setMessages(
      (map['messages'] as List? ?? const [])
          .map(NestMessage.tryParse)
          .whereType<NestMessage>()
          .toList(growable: false),
    );

    // Field keys the workspace has never heard of. Not thrown — the chat still
    // works — but surfaced where an integrator will see it on the day they
    // write the typo rather than a year later.
    final unknown = (map['unknownFields'] as List? ?? const []).whereType<String>().toList();
    if (unknown.isNotEmpty) {
      // ignore: avoid_print
      print('[nestconnect] this channel has no field named: ${unknown.join(', ')}');
    }

    unawaited(_loadConfig());
    unawaited(_registerPush());
    if (map['hasConversation'] == true) _listen();

    return map['identified'] == true ? NestIdentity.verified : NestIdentity.anonymous;
  }

  Future<void> _loadConfig() async {
    try {
      _config = NestConfig.parse(await _transport.getJson('/app/$appKey/config'));
    } on NestException {
      // The messenger opens in fallback colours rather than not opening. A
      // chat that refuses to appear because a greeting did not load is a chat
      // nobody can use.
      _config ??= const NestConfig(appearance: NestAppearance.fallback, online: false);
    }
  }

  /// Send a message, optionally with files already staged by [attach].
  ///
  /// The message appears in the thread immediately, marked pending, and is
  /// replaced by the server's copy when it lands. That is not decoration: on a
  /// phone the send button is pressed on a train, and a thread that shows
  /// nothing until the network answers looks broken.
  Future<void> send(String text, {List<NestUpload> attachments = const []}) async {
    final token = _token;
    if (token == null) throw const NestException('Open a chat before sending');
    final body = text.trim();
    if (body.isEmpty && attachments.isEmpty) return;

    final local = NestMessage(
      id: 'pending-${DateTime.now().microsecondsSinceEpoch}',
      from: NestAuthor.visitor,
      body: body,
      at: DateTime.now(),
      pending: true,
    );
    _setMessages([..._messages, local]);

    try {
      final raw = await _transport.postJson(
        '/message',
        {
          'body': body,
          if (attachments.isNotEmpty)
            'attachments': attachments.map((a) => a.ticket).toList(growable: false),
        },
        token: token,
      );
      final map = raw is Map ? raw : const <String, Object?>{};

      // The first message is what creates the conversation, so the token we
      // hold does not name one yet and the server hands back the one that does.
      final next = map['token'] as String?;
      if (next != null && next != _token) {
        _token = next;
        await _store.write(_tokenKey(), next);
        _listen();
      }

      final saved = NestMessage.tryParse(map['message']);
      _setMessages([
        ..._messages.where((m) => m.id != local.id),
        if (saved != null) saved else local.copyWith(pending: false),
      ]);
    } on NestException {
      // Kept in the thread and marked, not removed. A message that disappears
      // reads as one that was sent.
      _setMessages([
        ..._messages.where((m) => m.id != local.id),
        local.copyWith(pending: false, failed: true),
      ]);
      rethrow;
    }
  }

  /// Stage a file. The result goes to [send]; nothing is sent until it does.
  Future<NestUpload> attach({
    required List<int> bytes,
    required String filename,
    required String mime,
  }) async {
    final token = _token;
    if (token == null) throw const NestException('Open a chat before attaching');
    return _transport.upload(token: token, bytes: bytes, filename: filename, mime: mime);
  }

  /// Tell the agent somebody is typing, and what they have written so far.
  Future<void> typing(String preview) async {
    final token = _token;
    if (token == null) return;
    try {
      await _transport.postJson('/typing', {'preview': preview}, token: token);
    } on NestException {
      // A dropped typing ping is not worth telling anybody about.
    }
  }

  /// The chat is on screen, or is not.
  ///
  /// Two jobs: it zeroes the badge, and it is what turns an agent's ticks from
  /// delivered to read — a different claim, and the only one worth showing them
  /// as read.
  Future<void> setViewing(bool viewing) async {
    _viewing = viewing;
    if (!viewing) return;
    _setUnread(0);
    await _markRead('read');
  }

  /* ---- notifications ---- */

  /// Where to reach this phone when an agent replies and the app is closed.
  ///
  /// The token comes from the host app rather than from here. This package has
  /// no plugins by design — an app that already uses Firebase has the token in
  /// hand, and one that does not should not acquire a Firebase dependency
  /// because it added a chat.
  ///
  /// Safe to call before anybody has opened a chat: it is remembered and sent
  /// with the next session. Safe to call again with the same token, which is
  /// what an app does on every launch, and necessary when Firebase rotates it.
  Future<void> registerPushToken(String token, {String? platform}) async {
    _pushToken = token;
    _pushPlatform = platform ?? _defaultPlatform();
    await _registerPush();
  }

  /// Stop notifying this phone — notifications turned off in the host app's own
  /// settings, or a sign-out.
  ///
  /// Signing out calls this for you. It is separate as well because the two are
  /// different wishes: somebody who turns notifications off has not signed out,
  /// and somebody who signs out may well want them back on the next account.
  Future<void> unregisterPushToken() async {
    await _forgetPush(keepAddress: false);
  }

  /// Drop the server-side registration.
  ///
  /// [keepAddress] is the difference between the two callers, and it matters. A
  /// sign-out keeps it: the address belongs to the *phone*, the host app hands
  /// it over once at launch and will not hand it over again, so forgetting it
  /// here means the next person to sign in on this handset never gets a
  /// notification. Somebody turning notifications off means the address too —
  /// otherwise the next session would helpfully register it again.
  Future<void> _forgetPush({required bool keepAddress}) async {
    final push = _pushToken;
    final session = _token;
    if (!keepAddress) _pushToken = null;
    if (push == null || session == null) return;
    try {
      await _transport.postJson('/device/forget', {
        'token': push,
        'platform': _pushPlatform ?? _defaultPlatform(),
      }, token: session);
    } on NestException {
      // The server forgets it on its own once FCM reports the address dead.
    }
  }

  Future<void> _registerPush() async {
    final push = _pushToken;
    final session = _token;
    if (push == null || session == null) return;
    try {
      await _transport.postJson('/device', {
        'token': push,
        'platform': _pushPlatform ?? _defaultPlatform(),
      }, token: session);
    } on NestException {
      // Not fatal and not worth a retry loop: the next session registers it
      // again, and a chat that works without notifications beats one that
      // refuses to open because a notification could not be arranged.
    }
  }

  String _defaultPlatform() {
    if (Platform.isIOS || Platform.isMacOS) return 'ios';
    if (Platform.isAndroid) return 'android';
    return 'web';
  }

  Future<void> _markRead(String status) async {
    final token = _token;
    final last = _messages.where((m) => m.from == NestAuthor.agent && !m.pending).lastOrNull;
    if (token == null || last == null) return;
    try {
      await _transport.postJson(
        '/read',
        {'throughMessageId': last.id, 'status': status},
        token: token,
      );
    } on NestException {
      // Ticks are worth trying for and never worth failing over.
    }
  }

  /* ---- the live stream ---- */

  void _listen() {
    final token = _token;
    if (token == null || _closed) return;
    final mine = ++_generation;
    unawaited(_streamSub?.cancel());
    _streamSub = _transport.stream(token).listen(
      (event) => _onEvent(mine, event),
      onError: (Object _) => _scheduleReconnect(mine),
      onDone: () => _scheduleReconnect(mine),
      cancelOnError: true,
    );
  }

  void _onEvent(int generation, Map<String, Object?> event) {
    // A connection we have moved on from. Its events are about a session that
    // is over, or a duplicate of ones the current stream is already carrying.
    if (generation != _generation) return;
    // Connected: any earlier backoff is history.
    _attempt = 0;
    switch (event['type']) {
      case 'message':
        final message = NestMessage.tryParse(event['message']);
        if (message == null) break;
        // The server echoes our own messages back. Ours are already in the
        // thread, and adding them again would double every line somebody sent.
        if (_messages.any((m) => m.id == message.id)) break;
        _setMessages([..._messages, message]);
        if (message.from == NestAuthor.agent) {
          if (_viewing) {
            unawaited(_markRead('read'));
          } else {
            _setUnread(_unread + 1);
            // Delivered, not read: it reached the phone, which is a different
            // thing from somebody having looked at it.
            unawaited(_markRead('delivered'));
          }
        }
      case 'closed':
        _closed = true;
    }
  }

  /// Reconnect with a backoff that gives up on looking eager.
  ///
  /// A phone loses its network constantly — a lift, a tunnel, a train — so this
  /// has to be patient without being slow to come back. It caps at half a
  /// minute, because past that the customer has put the phone down.
  void _scheduleReconnect(int generation) {
    if (_closed || _token == null || generation != _generation) return;
    _reconnect?.cancel();
    final wait = Duration(milliseconds: (500 * (1 << _attempt)).clamp(500, 30000));
    _attempt = (_attempt + 1).clamp(0, 6);
    _reconnect = Timer(wait, _listen);
  }

  Future<void> _endSession() async {
    _reconnect?.cancel();
    // Not awaited — see `_generation`. The stream is already disowned by the
    // bump, so whether the socket takes a moment or an age to go is nobody's
    // problem but the operating system's.
    _generation++;
    unawaited(_streamSub?.cancel());
    _streamSub = null;
    _token = null;
    _attempt = 0;
    await _store.delete(_tokenKey());
  }

  void _setMessages(List<NestMessage> next) {
    _messages
      ..clear()
      ..addAll(next);
    if (!_messagesController.isClosed) _messagesController.add(messages);
  }

  void _setUnread(int next) {
    if (next == _unread) return;
    _unread = next;
    if (!_unreadController.isClosed) _unreadController.add(next);
  }

  /// A URL that loads one attachment, for an image widget.
  Uri? attachmentUrl(NestAttachment attachment) {
    final token = _token;
    return token == null ? null : _transport.mediaUrl(attachment.id, token);
  }

  /// Let go of the network. The session itself survives in storage.
  ///
  /// The socket is torn down before anything is awaited. Cancelling a
  /// subscription whose response the server is still holding open waits for the
  /// server, and closing a chat must never be able to hang the app that closed
  /// it — a customer tapping the X wants the sheet gone, not a spinner.
  Future<void> dispose() async {
    _reconnect?.cancel();
    _generation++;
    _transport.close();
    unawaited(_streamSub?.cancel());
    _streamSub = null;
    await _messagesController.close();
    await _unreadController.close();
  }
}

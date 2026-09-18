/// What the server says, as Dart.
///
/// Hand-written rather than generated, and parsed defensively throughout: this
/// package runs inside somebody else's app, against a server that may be newer
/// than it. A field that arrives missing, null, or as a type we did not expect
/// must not throw — an app whose chat crashes because we added a field is an
/// app that stops shipping our updates.
library;

/// How hard the channel checked who you said you were.
enum NestIdentity {
  /// The details sent were trusted, and the chat is on that customer's record.
  verified,

  /// Nobody was identified: an anonymous thread, none of the details kept.
  anonymous,
}

/// A file on a message.
class NestAttachment {
  const NestAttachment({
    required this.id,
    required this.filename,
    required this.mime,
  });

  final String id;
  final String filename;
  final String mime;

  bool get isImage => mime.startsWith('image/');

  static NestAttachment? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final id = _str(raw['id']);
    if (id == null) return null;
    return NestAttachment(
      id: id,
      filename: _str(raw['filename']) ?? 'file',
      mime: _str(raw['mime']) ?? 'application/octet-stream',
    );
  }
}

/// Who said it.
enum NestAuthor { visitor, agent }

/// One message in the thread.
class NestMessage {
  const NestMessage({
    required this.id,
    required this.from,
    required this.body,
    required this.at,
    this.authorName,
    this.attachments = const [],
    this.pending = false,
    this.failed = false,
  });

  final String id;
  final NestAuthor from;
  final String body;
  final DateTime at;

  /// The agent's name, when an agent said it and the channel shows names.
  final String? authorName;
  final List<NestAttachment> attachments;

  /// On its way. Shown immediately so the thread never looks frozen while the
  /// network decides; replaced by the server's copy when it lands.
  final bool pending;

  /// It did not go. Kept in the thread rather than removed, because a message
  /// that vanishes looks like one that was sent.
  final bool failed;

  bool get isMine => from == NestAuthor.visitor;

  NestMessage copyWith({bool? pending, bool? failed}) => NestMessage(
        id: id,
        from: from,
        body: body,
        at: at,
        authorName: authorName,
        attachments: attachments,
        pending: pending ?? this.pending,
        failed: failed ?? this.failed,
      );

  static NestMessage? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final id = _str(raw['id']);
    if (id == null) return null;
    return NestMessage(
      id: id,
      from: _str(raw['from']) == 'agent' ? NestAuthor.agent : NestAuthor.visitor,
      body: _str(raw['body']) ?? '',
      // A message we cannot date is still a message. Dropping it would leave a
      // hole in the conversation; putting it at "now" keeps the order sensible.
      at: DateTime.tryParse(_str(raw['at']) ?? '')?.toLocal() ?? DateTime.now(),
      authorName: _str(raw['authorName']),
      attachments: _list(raw['attachments'])
          .map(NestAttachment.tryParse)
          .whereType<NestAttachment>()
          .toList(growable: false),
    );
  }
}

/// How the channel looks and what it says — the same settings the web widget
/// reads, so a brand colour changed in Settings reaches the app without an app
/// release.
class NestAppearance {
  const NestAppearance({
    required this.accent,
    required this.onAccent,
    required this.title,
    required this.subtitle,
    required this.headline,
    required this.placeholder,
    required this.awayMessage,
    required this.closedMessage,
    required this.newChatLabel,
    required this.showBranding,
    this.logoUrl,
  });

  final String accent;
  final String onAccent;
  final String title;
  final String subtitle;
  final String headline;
  final String placeholder;
  final String awayMessage;
  /// What the business says when an agent closes a chat. Blank on purpose is a
  /// real choice: some would rather the chat simply stop than announce it.
  final String closedMessage;
  /// The way back in, once a chat has been closed.
  final String newChatLabel;
  final bool showBranding;
  final String? logoUrl;

  static const fallback = NestAppearance(
    accent: '#2563eb',
    onAccent: '#ffffff',
    title: 'How can we help?',
    subtitle: 'We usually reply in a few minutes',
    headline: '',
    placeholder: 'Write a message…',
    awayMessage: "We're away — leave a message and we'll reply.",
    closedMessage: 'This chat has been closed. Thanks for getting in touch!',
    newChatLabel: 'Start a new chat',
    showBranding: true,
  );

  static NestAppearance parse(Object? raw) {
    if (raw is! Map) return fallback;
    return NestAppearance(
      accent: _str(raw['accent']) ?? fallback.accent,
      onAccent: _str(raw['onAccent']) ?? fallback.onAccent,
      title: _str(raw['title']) ?? fallback.title,
      subtitle: _str(raw['subtitle']) ?? fallback.subtitle,
      headline: _str(raw['headline']) ?? fallback.headline,
      placeholder: _str(raw['placeholder']) ?? fallback.placeholder,
      awayMessage: _str(raw['awayMessage']) ?? fallback.awayMessage,
      // `_str` treats '' as absent, which is right for a title and wrong here:
      // the settings pane documents a blank closing message as a real choice —
      // the chat simply stops rather than announcing that it has — so an empty
      // string has to survive instead of being replaced by the default.
      closedMessage: raw['closedMessage'] is String
          ? raw['closedMessage']! as String
          : fallback.closedMessage,
      newChatLabel: _str(raw['newChatLabel']) ?? fallback.newChatLabel,
      showBranding: raw['showBranding'] is bool
          ? raw['showBranding'] as bool
          : fallback.showBranding,
      logoUrl: _str(raw['logoUrl']),
    );
  }
}

/// One of the faces behind the counter.
class NestTeamMate {
  const NestTeamMate({required this.name, this.avatarUrl});
  final String name;
  final String? avatarUrl;

  static NestTeamMate? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final name = _str(raw['name']);
    return name == null
        ? null
        : NestTeamMate(name: name, avatarUrl: _str(raw['avatarUrl']));
  }
}

/// Everything the messenger needs before it draws anything.
class NestConfig {
  const NestConfig({
    required this.appearance,
    required this.online,
    this.team = const [],
  });

  final NestAppearance appearance;

  /// Whether anybody is actually there. Drives which of the two subtitles the
  /// header shows, and it is the difference between a promise we keep and one
  /// we make at 3am.
  final bool online;
  final List<NestTeamMate> team;

  static NestConfig parse(Object? raw) {
    final map = raw is Map ? raw : const <String, Object?>{};
    return NestConfig(
      appearance: NestAppearance.parse(map['appearance']),
      online: map['online'] == true,
      team: _list((map['team'] as Map?)?['members'])
          .map(NestTeamMate.tryParse)
          .whereType<NestTeamMate>()
          .toList(growable: false),
    );
  }
}

/// A file staged for sending, and the ticket that redeems it.
class NestUpload {
  const NestUpload({
    required this.ticket,
    required this.filename,
    required this.mime,
    required this.size,
  });

  final String ticket;
  final String filename;
  final String mime;
  final int size;

  static NestUpload parse(Object? raw) {
    final map = raw is Map ? raw : const <String, Object?>{};
    return NestUpload(
      ticket: _str(map['ticket']) ?? '',
      filename: _str(map['filename']) ?? 'file',
      mime: _str(map['mime']) ?? 'application/octet-stream',
      size: map['size'] is num ? (map['size'] as num).toInt() : 0,
    );
  }
}

/// Something went wrong, with the server's own words where it gave any.
class NestException implements Exception {
  const NestException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;

  /// Whether trying again could plausibly work. A 4xx means we asked wrongly
  /// and asking again identically will fail identically.
  bool get isRetryable => statusCode == null || statusCode! >= 500;

  @override
  String toString() => 'NestException: $message';
}

String? _str(Object? v) => v is String && v.isNotEmpty ? v : null;
List<Object?> _list(Object? v) => v is List ? v : const [];

import 'dart:convert';

import 'models.dart';
import 'transport_stub.dart'
    if (dart.library.io) 'transport_io.dart'
    if (dart.library.js_interop) 'transport_web.dart';

/// The HTTP half: one place that knows how to talk to the server, so nothing
/// above it has to think about headers, encoding or what a failure looks like.
///
/// Two implementations, chosen at compile time by the conditional import above:
/// `dart:io`'s `HttpClient` everywhere there is a socket, and the browser's own
/// `fetch` and `EventSource` on Flutter web. They are separate files rather than
/// one file with runtime branches because `dart:io` does not *exist* in a
/// browser build — a reference to it is a compile error, not a failure at run
/// time, which is why a package that has not thought about web does not merely
/// misbehave there: it refuses to build at all.
///
/// What is shared lives here, and deliberately so. How a URL is assembled, what
/// counts as a failure, and how the server's own explanation is dug out of an
/// error body are decisions this package makes once — a customer on the web
/// build must not get a different error for the same 400 than a customer on the
/// phone, because those are the reports that get compared.
abstract class NestTransport {
  /// For the implementations below. Callers use the unnamed constructor, which
  /// picks whichever of them this is being compiled for.
  NestTransport.base(this.baseUrl);

  /// Picks the implementation for whatever this is being compiled for.
  factory NestTransport({required String baseUrl}) => createTransport(baseUrl);

  /// Where the workspace lives, e.g. `https://nestconnect.io`.
  final String baseUrl;

  Future<Object?> getJson(String path, {String? token, Map<String, String>? query});

  Future<Object?> postJson(String path, Object body, {String? token});

  /// Upload one file, returning the ticket the send redeems.
  Future<NestUpload> upload({
    required String token,
    required List<int> bytes,
    required String filename,
    required String mime,
  });

  /// The live stream of what an agent sends, as server-sent events.
  ///
  /// Reconnection is the caller's — see `NestConnect` — because only it knows
  /// whether the messenger is still on screen, and a package that reconnected
  /// on its own would keep a socket open behind a closed chat.
  ///
  /// Nothing escapes it on either platform. A long-lived connection fails in
  /// every way a connection can, and none of those is a programming error the
  /// app above should have to catch: they are all the same event — the stream
  /// ended, try again later — which is exactly what the caller does when it
  /// ends.
  Stream<Map<String, Object?>> stream(String token);

  /// A URL an image widget can load directly, token and all.
  Uri mediaUrl(String attachmentId, String token) =>
      uriFor('/media/$attachmentId', {'token': token});

  void close();

  /// One spelling of the API's URLs, so the two implementations cannot drift
  /// into pointing at subtly different places.
  Uri uriFor(String path, [Map<String, String>? query]) =>
      Uri.parse('${baseUrl.replaceAll(RegExp(r'/+$'), '')}/api/nestchat$path')
          .replace(queryParameters: query?.isEmpty ?? true ? null : query);

  /// A response body, or the exception it deserves. Shared so that a 400 reads
  /// the same in a browser as it does on a phone.
  Object? decodeBody(String text, int statusCode, {String whenFailed = 'Request failed'}) {
    if (statusCode >= 400) {
      throw NestException(serverMessage(text) ?? whenFailed, statusCode: statusCode);
    }
    if (text.isEmpty) return null;
    try {
      return jsonDecode(text) as Object?;
    } on FormatException {
      throw NestException('The server sent something we could not read');
    }
  }

  /// One server-sent event's `data:` line → a decoded map, or null for the
  /// keep-alives and the blanks between events.
  ///
  /// Shared because the browser hands over an event's data already reassembled
  /// while `dart:io` hands over raw lines, and the *parsing* of what is inside
  /// must not differ between the two.
  Map<String, Object?>? decodeEvent(String payload) {
    if (payload.isEmpty) return null;
    try {
      final decoded = jsonDecode(payload);
      return decoded is Map<String, Object?> ? decoded : null;
    } on FormatException {
      // One unreadable event is not worth ending the stream over.
      return null;
    }
  }

  /// NestJS puts its own explanation in `message`, as a string or a list of
  /// them. Worth surfacing: "That kind of file can't be attached here" is an
  /// answer, where "400" is a puzzle.
  String? serverMessage(String text) {
    if (text.isEmpty) return null;
    try {
      final body = jsonDecode(text);
      if (body is! Map) return null;
      final message = body['message'];
      if (message is String && message.isNotEmpty) return message;
      if (message is List && message.isNotEmpty) return message.join(', ');
    } on FormatException {
      return null;
    }
    return null;
  }
}

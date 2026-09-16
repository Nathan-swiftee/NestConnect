import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'models.dart';

/// The HTTP half: one place that knows how to talk to the server, so nothing
/// above it has to think about headers, encoding or what a failure looks like.
///
/// Built on `dart:io`'s own client rather than `package:http`, because this
/// package ships inside somebody else's app and every dependency it takes is
/// one they inherit — and one more chance of a version conflict with whatever
/// they already use.
class NestTransport {
  NestTransport({required this.baseUrl, HttpClient? client})
      : _client = client ?? HttpClient() {
    // A chat is a foreground thing. Waiting half a minute on a dead network
    // before saying so is worse than saying so.
    _client.connectionTimeout = const Duration(seconds: 10);
  }

  /// Where the workspace lives, e.g. `https://nestconnect.io`.
  final String baseUrl;
  final HttpClient _client;

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('${baseUrl.replaceAll(RegExp(r'/+$'), '')}/api/nestchat$path')
          .replace(queryParameters: query?.isEmpty ?? true ? null : query);

  Future<Object?> getJson(String path, {String? token, Map<String, String>? query}) =>
      _send('GET', path, token: token, query: query);

  Future<Object?> postJson(String path, Object body, {String? token}) =>
      _send('POST', path, body: body, token: token);

  Future<Object?> _send(
    String method,
    String path, {
    Object? body,
    String? token,
    Map<String, String>? query,
  }) async {
    HttpClientResponse res;
    try {
      final req = await _client.openUrl(method, _uri(path, query));
      req.headers.set(HttpHeaders.acceptHeader, 'application/json');
      if (token != null) req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      if (body != null) {
        req.headers.contentType = ContentType.json;
        req.write(jsonEncode(body));
      }
      res = await req.close();
    } on SocketException catch (e) {
      // No status code: nothing answered, so this is worth retrying.
      throw NestException('Could not reach the server: ${e.message}');
    } on HttpException catch (e) {
      throw NestException(e.message);
    }

    final text = await res.transform(utf8.decoder).join();
    if (res.statusCode >= 400) {
      throw NestException(_serverMessage(text) ?? 'Request failed', statusCode: res.statusCode);
    }
    if (text.isEmpty) return null;
    try {
      return jsonDecode(text) as Object?;
    } on FormatException {
      throw NestException('The server sent something we could not read');
    }
  }

  /// Upload one file. Multipart is hand-rolled for the same reason the rest of
  /// this is: it is thirty lines, and the alternative is a dependency.
  Future<NestUpload> upload({
    required String token,
    required List<int> bytes,
    required String filename,
    required String mime,
  }) async {
    final boundary = '----nest${DateTime.now().microsecondsSinceEpoch}';
    final head = utf8.encode(
      '--$boundary\r\n'
      // The filename is quoted and stripped of the two characters that would
      // let it break out of the header it sits in.
      'Content-Disposition: form-data; name="file"; filename="${filename.replaceAll(RegExp(r'["\r\n]'), '_')}"\r\n'
      'Content-Type: $mime\r\n\r\n',
    );
    final tail = utf8.encode('\r\n--$boundary--\r\n');

    try {
      final req = await _client.postUrl(_uri('/upload'));
      req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      req.headers.set(HttpHeaders.contentTypeHeader, 'multipart/form-data; boundary=$boundary');
      req.headers.set(HttpHeaders.contentLengthHeader, head.length + bytes.length + tail.length);
      req
        ..add(head)
        ..add(bytes)
        ..add(tail);
      final res = await req.close();
      final text = await res.transform(utf8.decoder).join();
      if (res.statusCode >= 400) {
        throw NestException(_serverMessage(text) ?? 'Upload failed', statusCode: res.statusCode);
      }
      return NestUpload.parse(jsonDecode(text) as Object?);
    } on SocketException catch (e) {
      throw NestException('Could not reach the server: ${e.message}');
    }
  }

  /// The live stream of what an agent sends, as server-sent events.
  ///
  /// Reconnection is the caller's — see `NestConnect` — because only it knows
  /// whether the messenger is still on screen, and a package that reconnected
  /// on its own would keep a socket open behind a closed chat.
  Stream<Map<String, Object?>> stream(String token) async* {
    // Nothing escapes this. A long-lived socket fails in every way a socket
    // can — a tunnel, a proxy timeout, this client being closed underneath it
    // while the customer taps away the sheet — and none of those is a
    // programming error the app above should have to catch. They are all the
    // same event: the stream ended, try again later, which is precisely what
    // the caller does when it ends.
    //
    // Catching narrowly is not enough, and that is what the tests found: an
    // error arriving *after* the subscription is cancelled has nowhere to go
    // and surfaces as an unhandled zone error — a crash in somebody's app,
    // caused by them closing the chat.
    try {
      final req = await _client.getUrl(_uri('/stream', {'token': token}));
      req.headers.set(HttpHeaders.acceptHeader, 'text/event-stream');
      final res = await req.close();
      if (res.statusCode >= 400) return;
      // Lines, not chunks: an event can be split across two reads, and treating
      // a chunk as a message loses half of one every time the network divides
      // them differently.
      await for (final line in res.transform(utf8.decoder).transform(const LineSplitter())) {
        if (!line.startsWith('data:')) continue; // ": ping" keep-alives, and blanks
        final payload = line.substring(5).trim();
        if (payload.isEmpty) continue;
        try {
          final decoded = jsonDecode(payload);
          if (decoded is Map<String, Object?>) yield decoded;
        } on FormatException {
          // One unreadable event is not worth ending the stream over.
        }
      }
    } catch (_) {
      return;
    }
  }

  /// A URL an image widget can load directly, token and all.
  Uri mediaUrl(String attachmentId, String token) =>
      _uri('/media/$attachmentId', {'token': token});

  void close() => _client.close(force: true);

  /// NestJS puts its own explanation in `message`, as a string or a list of
  /// them. Worth surfacing: "That kind of file can't be attached here" is an
  /// answer, where "400" is a puzzle.
  String? _serverMessage(String text) {
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

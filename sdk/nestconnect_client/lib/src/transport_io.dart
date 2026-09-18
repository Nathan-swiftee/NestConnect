import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'models.dart';
import 'transport.dart';

/// Everywhere there is a socket: a phone, a desktop, a server, a test.
///
/// Built on `dart:io`'s own client rather than `package:http`, because this
/// package ships inside somebody else's app and every dependency it takes is
/// one they inherit — and one more chance of a version conflict with whatever
/// they already use.
NestTransport createTransport(String baseUrl) => IoTransport(baseUrl: baseUrl);

class IoTransport extends NestTransport {
  IoTransport({required String baseUrl, HttpClient? client})
      : _client = client ?? HttpClient(),
        super.base(baseUrl) {
    // A chat is a foreground thing. Waiting half a minute on a dead network
    // before saying so is worse than saying so.
    _client.connectionTimeout = const Duration(seconds: 10);
  }

  final HttpClient _client;

  @override
  Future<Object?> getJson(String path, {String? token, Map<String, String>? query}) =>
      _send('GET', path, token: token, query: query);

  @override
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
      final req = await _client.openUrl(method, uriFor(path, query));
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

    return decodeBody(await res.transform(utf8.decoder).join(), res.statusCode);
  }

  /// Multipart is hand-rolled for the same reason the rest of this is: it is
  /// thirty lines, and the alternative is a dependency. (The browser has
  /// `FormData` and does not need it — see `transport_web.dart`.)
  @override
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
      final req = await _client.postUrl(uriFor('/upload'));
      req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      req.headers.set(HttpHeaders.contentTypeHeader, 'multipart/form-data; boundary=$boundary');
      req.headers.set(HttpHeaders.contentLengthHeader, head.length + bytes.length + tail.length);
      req
        ..add(head)
        ..add(bytes)
        ..add(tail);
      final res = await req.close();
      final text = await res.transform(utf8.decoder).join();
      return NestUpload.parse(decodeBody(text, res.statusCode, whenFailed: 'Upload failed'));
    } on SocketException catch (e) {
      throw NestException('Could not reach the server: ${e.message}');
    }
  }

  @override
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
      final req = await _client.getUrl(uriFor('/stream', {'token': token}));
      req.headers.set(HttpHeaders.acceptHeader, 'text/event-stream');
      final res = await req.close();
      if (res.statusCode >= 400) return;
      // Lines, not chunks: an event can be split across two reads, and treating
      // a chunk as a message loses half of one every time the network divides
      // them differently.
      await for (final line in res.transform(utf8.decoder).transform(const LineSplitter())) {
        if (!line.startsWith('data:')) continue; // ": ping" keep-alives, and blanks
        final event = decodeEvent(line.substring(5).trim());
        if (event != null) yield event;
      }
    } catch (_) {
      return;
    }
  }

  @override
  void close() => _client.close(force: true);
}

import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

import 'models.dart';
import 'transport.dart';

/// Flutter web: the browser's own `fetch` and `EventSource`.
///
/// The server needs nothing special for this. `/api/nestchat` already answers
/// with `Access-Control-Allow-Origin: *` — the embeddable widget runs in an
/// iframe on other people's sites, so the public chat API was always reachable
/// cross-origin — and the stream takes its token in the query string rather
/// than a header, which is what makes `EventSource` usable at all: the browser
/// gives no way to set one on it.
NestTransport createTransport(String baseUrl) => WebTransport(baseUrl: baseUrl);

class WebTransport extends NestTransport {
  WebTransport({required String baseUrl}) : super.base(baseUrl);

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
    final headers = <String, String>{
      'accept': 'application/json',
      if (token != null) 'authorization': 'Bearer $token',
      if (body != null) 'content-type': 'application/json',
    };
    final web.Response res;
    final String text;
    try {
      res = await web.window
          .fetch(
            uriFor(path, query).toString().toJS,
            web.RequestInit(
              method: method,
              headers: headers.jsify() as web.HeadersInit,
              body: body == null ? null : jsonEncode(body).toJS,
            ),
          )
          .toDart;
      text = await res.text().toDart.then((t) => t.toDart);
    } catch (e) {
      // `fetch` rejects for exactly two reasons a customer can cause: the
      // network is gone, or the browser refused the request (CORS, a blocked
      // mixed-content call). Neither carries a status, and both mean the same
      // thing to the app above — nothing answered.
      throw NestException('Could not reach the server: ${_reason(e)}');
    }
    return decodeBody(text, res.status);
  }

  /// No hand-rolled multipart here, unlike `dart:io`: the browser has
  /// `FormData`, which sets its own boundary and escapes the filename itself.
  @override
  Future<NestUpload> upload({
    required String token,
    required List<int> bytes,
    required String filename,
    required String mime,
    Map<String, String> fields = const {},
  }) async {
    final blob = web.Blob(
      [Uint8List.fromList(bytes).toJS].toJS,
      web.BlobPropertyBag(type: mime),
    );
    final form = web.FormData();
    // Before the file, so the server has the fields off the request before it
    // has finished receiving the audio.
    // `append` with a string value rather than a Blob — package:web models
    // the two overloads as one method taking a JSAny.
    fields.forEach((name, value) => form.append(name, value.toJS));
    form.append('file', blob, filename);

    final web.Response res;
    final String text;
    try {
      res = await web.window
          .fetch(
            uriFor('/upload').toString().toJS,
            web.RequestInit(
              method: 'POST',
              // Deliberately no content-type: the browser has to set it, because
              // only it knows the boundary it generated. Setting it by hand is
              // the classic way to make a multipart upload arrive unparseable.
              headers: {'authorization': 'Bearer $token'}.jsify() as web.HeadersInit,
              body: form,
            ),
          )
          .toDart;
      text = await res.text().toDart.then((t) => t.toDart);
    } catch (e) {
      throw NestException('Could not reach the server: ${_reason(e)}');
    }
    return NestUpload.parse(decodeBody(text, res.status, whenFailed: 'Upload failed'));
  }

  @override
  Stream<Map<String, Object?>> stream(String token) {
    // A controller rather than an async* loop: `EventSource` is a callback API,
    // and this is the seam that turns it into the same Stream the io transport
    // returns.
    late final web.EventSource source;
    late final StreamController<Map<String, Object?>> controller;

    void closeSource() {
      // Closing it is what stops the browser reconnecting on its own. That
      // reconnection sounds helpful and is not: `NestConnect` already backs off
      // and re-subscribes when it wants to, and a socket the browser reopens
      // behind a closed chat is one nobody asked for and nobody will close.
      source.close();
      if (!controller.isClosed) controller.close();
    }

    controller = StreamController<Map<String, Object?>>(
      onCancel: () => closeSource(),
    );

    source = web.EventSource(uriFor('/stream', {'token': token}).toString())
      ..onmessage = ((web.MessageEvent event) {
        final data = event.data;
        if (data == null) return;
        final decoded = decodeEvent((data as JSString).toDart.trim());
        if (decoded != null && !controller.isClosed) controller.add(decoded);
      }).toJS
      // An error here is the connection ending, not something the app should
      // catch — the same event the io transport turns into "the stream
      // finished". So the stream ends, and the caller reconnects on its own
      // terms, which is the one place that knows whether the chat is still up.
      ..onerror = ((web.Event _) => closeSource()).toJS;

    return controller.stream;
  }

  /// Nothing is held open between requests in a browser, so there is nothing
  /// to tear down — each `stream` closes its own `EventSource` when cancelled.
  @override
  void close() {}

  /// What a rejected `fetch` was about. The browser's own message is usually
  /// "Failed to fetch", which is not much, but it is more than an empty string.
  String _reason(Object e) {
    final text = e.toString();
    return text.isEmpty ? 'the request did not complete' : text;
  }
}

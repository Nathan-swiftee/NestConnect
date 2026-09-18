# nestconnect_client

The transport half of the Nest Connect Flutter SDK: sessions, messages,
attachments and the live stream. Pure Dart, no Flutter dependency, and nothing
outside the standard library — so an app that takes it inherits nothing.

```dart
final chat = NestConnect(baseUrl: 'https://nestconnect.io', appKey: 'na_…');

// Who this is. `userHash` is an HMAC-SHA256 of the user id under the channel's
// signing secret, made by YOUR backend — never in the app, because anything in
// a binary can be taken out of one.
await chat.login(userId: user.id, name: user.name, userHash: user.nestHash);

// The thread for one order. Leave `fields` off for a single ongoing chat.
await chat.open(fields: {'order_id': 'DG-88412'});

chat.onMessages.listen(render);
chat.onUnread.listen(setBadge);
await chat.send('Where is my order?');
```

The app key comes from Settings › NestChat widget › In-app SDK, and identifies
a channel without authorising anything else — safe in a binary, and for the same
reason not proof of who is using it.

## Platforms

Anywhere Dart runs, browsers included. The transport is chosen at compile time:
`dart:io`'s `HttpClient` where there is a socket, and the browser's own `fetch`
and `EventSource` on Flutter web.

That split is a compile-time one because the failure it avoids is a compile
failure — `dart:io` does not exist in a browser build, so a package that reaches
for it does not misbehave on web, it refuses to build. CI compiles the package
for the browser on every push and checks the browser transport is the one that
came out, because neither of those is something a test run can tell you.

Nothing is needed on the server for web: the chat API already answers
cross-origin (the embeddable widget runs in an iframe on other people's sites)
and the stream takes its token in the query string, which is what makes
`EventSource` usable — a browser gives no way to set a header on one.

One behaviour differs, and deliberately. `registerPushToken` reports the
platform as `web` in a browser, including on an iPhone: a Flutter web page has
no APNs address and is not reachable the way an installed app is, so filing it
under `ios` would file it under an address it does not have.

## Things worth knowing

**A sent message appears before the network answers**, marked pending, and is
replaced by the server's copy when it lands. One that fails stays in the thread
marked failed rather than vanishing — a message that disappears reads as one
that was sent.

**Nothing throws from the live stream.** A dropped socket is an ordinary end to
a long-lived connection, not an error an app should catch, so the stream simply
ends and reconnects with a backoff capped at thirty seconds.

**Closing never blocks.** `dispose()` tears the socket down before it awaits
anything: a customer tapping the X wants the sheet gone, not a spinner.

**Push tokens come from you.** `registerPushToken` takes an address this
package never asks Firebase for — no plugin, no native configuration. Call it
whenever you have one; it is remembered and registered with the next session, so
the usual order (Firebase hands over a token at launch, somebody opens the chat
an hour later) works without you sequencing it. `logout()` stops notifications
for that account but keeps the address, because the address belongs to the
handset rather than to whoever was signed in.

**A closed chat is a state, not a message.** An agent closing a conversation
sends no message, so nothing on `onMessages` fires — watch `onClosed` instead, or
a UI reading only the thread will leave somebody typing into a composer that
still looks live. `startNewChat()` begins a fresh conversation for the same
customer; a closed one is never resumed server-side, so nothing else is needed.

**Tokens are kept where you say.** `NestTokenStore` is an interface; the default
forgets on exit. A Flutter app plugs in secure storage without this package
depending on a plugin.

## Tests

`dart test` stands up a real `HttpServer` speaking the API's shapes. A fake
client would only prove this package calls methods we wrote; what matters is
whether it and the server agree.

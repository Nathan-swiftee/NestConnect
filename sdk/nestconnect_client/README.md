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

**Tokens are kept where you say.** `NestTokenStore` is an interface; the default
forgets on exit. A Flutter app plugs in secure storage without this package
depending on a plugin.

## Tests

`dart test` stands up a real `HttpServer` speaking the API's shapes. A fake
client would only prove this package calls methods we wrote; what matters is
whether it and the server agree.

# nestconnect_flutter

Nest Connect live chat inside your Flutter app.

```dart
final chat = NestConnect(baseUrl: 'https://nestconnect.io', appKey: 'na_…');

await chat.login(userId: user.id, name: user.name, userHash: user.nestHash);
await chat.open(fields: {'order_id': order.id});

// A launcher over your page…
Stack(children: [
  page,
  Positioned(right: 16, bottom: 16, child: NestLauncher(chat: chat)),
]);

// …or open it from anywhere.
showNestMessenger(context, chat: chat);
```

## No plugins

Nothing here needs native build configuration or a permissions prompt. The one
thing that would — picking a photo — is handed back to you, because your app
already has a picker and already has the permission:

```dart
NestLauncher(
  chat: chat,
  onPickFile: () async {
    final file = await myExistingPicker();
    return file == null
        ? null
        : NestPickedFile(bytes: file.bytes, filename: file.name, mime: file.mime);
  },
);
```

Leave `onPickFile` off and there is no attach button, which is better than a
button that opens nothing.

## Notifications

Same principle: the token comes from you. An app that already uses Firebase has
it in hand, and one that doesn't shouldn't acquire a Firebase dependency because
it added a chat.

```dart
final token = await FirebaseMessaging.instance.getToken();
if (token != null) await chat.registerPushToken(token);

// Firebase rotates tokens. Pass the new one on.
FirebaseMessaging.instance.onTokenRefresh.listen(chat.registerPushToken);
```

Call it whenever you have the token — before anyone has opened a chat is normal,
and it is remembered and registered with the next session. `chat.logout()`
already tells the server to stop pushing for that account; call
`chat.unregisterPushToken()` separately when someone turns notifications off
without signing out.

A reply arriving while the chat is open on screen is **not** pushed — it is
already there. Everything else is, addressed to your Firebase project so the
banner carries your app's name and icon. Add the service-account key under
Settings › NestChat widget › In-app SDK; without it nothing is pushed at all.

Messages carry `data.source == 'nestconnect'` and a `conversationId`, so tapping
one can open the messenger:

```dart
FirebaseMessaging.onMessageOpenedApp.listen((m) {
  if (m.data['source'] == 'nestconnect') showNestMessenger(context, chat: chat);
});
```

On Android, create a notification channel with id `nest_messages` — without it
Android 8+ drops the notification silently.

## The look is the channel's

Colours, the greeting, the away message and whether the team's faces show all
come from Settings › NestChat widget, so changing one reaches customers without
an app release. Your app's typography is inherited, so the chat still reads as
part of your app rather than as a pasted-in web view.

## Tests

`flutter test` renders the messenger against a real `HttpServer` on loopback.
Two things are worth knowing if you add to them: `flutter_test` installs an
`HttpClient` that answers 400 to everything, so `HttpOverrides.global = null`
is what lets these reach the loopback server; and a network request *started*
under the widget-test clock never completes, so anything that has to reach the
wire belongs in `nestconnect_client`'s tests, where it runs in real time.

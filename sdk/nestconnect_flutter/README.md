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

## Which version am I running?

```dart
debugPrint('Nest Connect SDK $nestConnectSdkVersion');
```

Worth printing somewhere your own diagnostics can see. The SDK is consumed as a
git dependency, and `pubspec.lock` pins the commit it resolved to — so
`flutter pub get` keeps giving you the build you already have. `flutter pub
upgrade nestconnect_flutter nestconnect_client` is what moves it, and the three
plugins below mean a **native rebuild**, not a hot restart.

## Three plugins, and the one thing still handed back to you

Recording and playing audio, and opening a link, cannot be done from Flutter
without native code — so `record`, `just_audio` and `url_launcher` are bundled
rather than left to you to choose and wire. What that costs, said plainly: your
store listing inherits a microphone permission whether or not you turn voice
notes on. Nobody is *prompted* by a chat they merely opened — `record` asks when
recording actually starts.

Picking a photo is still yours, because your app already has a picker and
already has the permission:

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

## The home screen, and earlier conversations

Turn on Settings › NestChat widget › Home screen and the messenger opens on
cards instead of straight into the conversation: the chat itself first, then this
customer's own earlier conversations, then the business's other ways of being
reached. Leave it off — the default — and nothing changes: the chat opens on the
conversation exactly as before.

The earlier ones matter more than they sound. A chat the business resolves is
never resumed, so until now the moment an agent closed a thread it left the
customer's side entirely: they reopened the chat, found an empty box, and
everything agreed about their order was readable only by the business. They are
read-only — a new message starts a new conversation rather than reopening
somebody's finished ticket.

Tapping one of the business's cards hands its link to the phone: a help centre
to the browser, a `tel:` to the dialler, a `mailto:` to Mail. An app that would
rather keep people inside passes its own handler:

```dart
showNestMessenger(
  context,
  chat: chat,
  onOpenLink: (card) => myInAppBrowser.open(card.href),
);
```

If you have built your own UI on `NestConnect`, `config?.home` is the cards,
`conversations()` is the history, and `conversation(id)` reads one of them.

## When an agent closes the chat

The messenger swaps the composer for the channel's own closing words and a
button that starts another conversation. Both come from Settings › NestChat
widget, so a business changes them without an app release, and a blank closing
message is honoured — the chat simply stops rather than announcing it.

Nothing to wire: `NestMessenger` does it. If you have built your own UI on
`NestConnect`, `isClosed` and the `onClosed` stream are what to watch, and
`startNewChat()` is the way back — the same customer, a new thread, their
history and push registration intact.

## Web

Works on Flutter web with no extra setup — the client picks the browser's own
`fetch` and `EventSource` when compiled for it.

Two things behave differently there, both because a browser tab is not an
installed app. Notifications register with the platform recorded as `web`, and
`FirebaseMessaging` on web needs a service worker your app provides, so treat
push as opt-in rather than assuming it. And a page has no photo library: the
`onPickFile` you already pass is still the way files get in, and on web that is
an `<input type="file">` behind whatever picker you use.

## The look is the channel's

Colours, the greeting, the away message and whether the team's faces show all
come from Settings › NestChat widget, so changing one reaches customers without
an app release. Your app's typography is inherited, so the chat still reads as
part of your app rather than as a pasted-in web view.

## Tests

`flutter test` renders the messenger against a real `HttpServer` on loopback.
Two things are worth knowing if you add to them: `flutter_test` installs an
`HttpClient` that answers 400 to everything, so `HttpOverrides.global = null`
is what lets these reach the loopback server; and a request started under the
widget-test clock only progresses while `tester.runAsync` is holding the door
open, so one that is kicked off by a tap usually needs two of those windows
before its answer is on screen — one to send it and one to carry it back.

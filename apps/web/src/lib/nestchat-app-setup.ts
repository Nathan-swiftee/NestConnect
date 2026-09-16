import type { NestChatApp } from "@ding/schemas";

/**
 * What the app developer has to do, built from what this channel is actually
 * set to.
 *
 * Its own module rather than JSX in the settings pane, for the same reason as
 * the embed snippet: this is code somebody pastes into a production app, and a
 * wrong key or a stale signature recipe costs them an afternoon. Here it can be
 * asserted on.
 *
 * Generated rather than written once as documentation because the interesting
 * half is channel-specific and we already know it: the key, the field names
 * this channel will accept, whether identity is enforced, whether push is
 * configured. A generic page would make the integrator ask us all four.
 */

export interface AppSetupInput {
  /** Origin of the API the SDK talks to. */
  apiUrl: string;
  /** The app key, if the surface is on. */
  appKey?: string;
  app: NestChatApp;
  hasIdentitySecret: boolean;
  hasPushCredential: boolean;
  /** Conversation field keys this channel will accept in `fields:`. */
  fieldKeys: string[];
}

export interface AppSetupStep {
  title: string;
  body: string;
  code?: string;
  /**
   * Something on *our* side that isn't done yet, so this step cannot work.
   *
   * Kept separate from the body because it is the one thing on the page the
   * person reading it can fix themselves — everything else is for the app
   * developer, and a blocker buried in a paragraph of Dart is a blocker nobody
   * sees.
   */
  blocked?: string;
}

/** Fields to show in the example call. Two is enough to show the shape. */
const EXAMPLE_FIELDS = 2;

export function appSetupGuide(input: AppSetupInput): AppSetupStep[] {
  const { apiUrl, appKey, app, hasIdentitySecret, hasPushCredential, fieldKeys } = input;
  const key = appKey ?? "na_…";
  const steps: AppSetupStep[] = [];

  steps.push({
    title: "Add the packages",
    body: "Two packages: the client, which has no dependencies at all, and the Flutter widgets on top of it. Neither needs native build configuration.",
    code: [
      "dependencies:",
      "  nestconnect_client:",
      "    git:",
      "      url: https://github.com/Nathan-swiftee/NestConnect.git",
      "      path: sdk/nestconnect_client",
      "  nestconnect_flutter:",
      "    git:",
      "      url: https://github.com/Nathan-swiftee/NestConnect.git",
      "      path: sdk/nestconnect_flutter",
    ].join("\n"),
  });

  steps.push({
    title: "Create the chat once, and keep it",
    body: "One of these for the app's lifetime — it owns the session, the thread and the live connection. Put it wherever your other singletons live. The key is public: it names this channel and authorises nothing.",
    code: [
      "import 'package:nestconnect_flutter/nestconnect_flutter.dart';",
      "",
      "final chat = NestConnect(",
      `  baseUrl: '${apiUrl}',`,
      `  appKey: '${key}',`,
      ");",
    ].join("\n"),
    blocked: appKey
      ? undefined
      : "Turn the in-app SDK on above to mint this channel's key.",
  });

  steps.push(identityStep(app, hasIdentitySecret));

  if (app.identity !== "off") {
    steps.push({
      title: "Sign user ids on your backend",
      body: "HMAC-SHA256 of the user id under this channel's signing secret, returned to the app with the rest of the user's profile. Never put the secret in the app — anything in a binary can be pulled out of one, and whoever holds it can claim to be any of your customers.",
      code: [
        "// Node, on your own server — never in the app.",
        "import { createHmac } from 'node:crypto';",
        "",
        "const nestHash = createHmac('sha256', process.env.NEST_SIGNING_SECRET)",
        "  .update(String(user.id))",
        "  .digest('hex');",
      ].join("\n"),
      blocked: hasIdentitySecret
        ? undefined
        : "Create the signing secret above, then put it in your backend's environment.",
    });
  }

  steps.push(openStep(app, fieldKeys));

  steps.push({
    title: "Put a way in",
    body: "A floating launcher over a page, badged with what is waiting — or open the chat from a menu item you already have. Both take the same picker, which is how attachments work: your app already has one and already has the permission, so we ask yours rather than shipping another.",
    code: [
      "// A launcher over your page…",
      "Stack(children: [",
      "  page,",
      "  Positioned(right: 16, bottom: 16, child: NestLauncher(",
      "    chat: chat,",
      "    onPickFile: () async {",
      "      final file = await myExistingPicker();",
      "      return file == null ? null : NestPickedFile(",
      "        bytes: file.bytes, filename: file.name, mime: file.mime);",
      "    },",
      "  )),",
      "]);",
      "",
      "// …or from anywhere.",
      "showNestMessenger(context, chat: chat);",
    ].join("\n"),
  });

  steps.push(pushStep(hasPushCredential));

  steps.push({
    title: "Sign out with the user",
    body: "Two people share a phone. Without this the next one opens the chat and finds the last one's conversation. It also stops notifications for that account, while keeping the push address — that belongs to the handset, so the next person to sign in is still reachable.",
    code: "await chat.logout();",
  });

  return steps;
}

function identityStep(app: NestChatApp, hasSecret: boolean): AppSetupStep {
  const tag = app.contactTag.trim();
  const tagged = tag ? ` Everyone who chats here is tagged “${tag}”.` : "";

  if (app.identity === "required") {
    return {
      title: "Say who the user is",
      body: `This channel only believes a signed claim, so \`userHash\` is required — without it the chat opens anonymously and the name, email and phone are discarded.${tagged}`,
      code: [
        "await chat.login(",
        "  userId: user.id,        // your own id — this is the contact key",
        "  userHash: user.nestHash, // from your backend, see below",
        "  name: user.name,",
        "  email: user.email,",
        "  phone: user.phone,",
        ");",
      ].join("\n"),
      blocked: hasSecret
        ? undefined
        : "Identity is set to required but this channel has no signing secret, so every session will be anonymous. Create one above.",
    };
  }

  if (app.identity === "optional") {
    return {
      title: "Say who the user is",
      body: `\`userId\` is your own id and becomes the contact key, so a reinstall or a new phone resumes the same history. \`userHash\` is optional today and checked when sent.${tagged}`,
      code: [
        "await chat.login(",
        "  userId: user.id,        // your own id — this is the contact key",
        "  userHash: user.nestHash, // optional for now; see below",
        "  name: user.name,",
        "  email: user.email,",
        "  phone: user.phone,",
        ");",
      ].join("\n"),
      blocked:
        "Until your backend signs, anyone who pulls the key out of the app can claim to be any of your customers and read their replies. Worth treating as a dated commitment rather than an open one.",
    };
  }

  return {
    title: "Say who the user is",
    body: `Whatever the app sends is believed, which is fine while nobody signs in and wrong the moment the app knows who its user is.${tagged}`,
    code: [
      "await chat.login(",
      "  userId: user.id,   // your own id — this is the contact key",
      "  name: user.name,",
      "  email: user.email,",
      ");",
    ].join("\n"),
  };
}

function openStep(app: NestChatApp, fieldKeys: string[]): AppSetupStep {
  const threadKey = app.threadFieldKey.trim();
  // The thread key first: it is the one whose absence changes behaviour rather
  // than only losing a value.
  const ordered = threadKey
    ? [threadKey, ...fieldKeys.filter((k) => k !== threadKey)]
    : [...fieldKeys];
  const shown = ordered.slice(0, EXAMPLE_FIELDS);

  const fieldsArg = shown.length
    ? `fields: {${shown.map((k) => `'${k}': …`).join(", ")}}`
    : "";

  const body = threadKey
    ? `Each \`${threadKey}\` gets its own conversation — opening the chat for one finds that thread or starts it. Send it every time, or everything lands in a single thread.`
    : "This channel gives each customer one ongoing conversation. Send any field values you have and they land on it.";

  const known = fieldKeys.length
    ? `Fields this channel accepts: ${fieldKeys.map((k) => `\`${k}\``).join(", ")}. Anything else is refused rather than quietly stored, so a typo fails at integration time instead of a year later.`
    : "No custom fields are defined for this channel yet — add them under Settings › Custom fields and they become sendable here.";

  return {
    title: "Open it with the context you have",
    body: `${body} ${known}`,
    code: fieldsArg
      ? `showNestMessenger(context, chat: chat);\n\n// …or carry the context in, from wherever the user tapped:\nawait chat.open(${fieldsArg});`
      : "showNestMessenger(context, chat: chat);",
    blocked:
      threadKey && !fieldKeys.includes(threadKey)
        ? `This channel keys threads on “${threadKey}”, but no such field is available here — every conversation would share one thread. Check Settings › Custom fields.`
        : undefined,
  };
}

function pushStep(hasPushCredential: boolean): AppSetupStep {
  return {
    title: "Notifications",
    body: "The token comes from you — an app that already uses Firebase has it in hand. Call it whenever you have one, including before anybody has opened a chat: it is remembered and registered with the next session. A reply arriving while the chat is open on screen is deliberately not pushed.",
    code: [
      "final token = await FirebaseMessaging.instance.getToken();",
      "if (token != null) await chat.registerPushToken(token);",
      "FirebaseMessaging.instance.onTokenRefresh.listen(chat.registerPushToken);",
      "",
      "// Open the thread when somebody taps the banner.",
      "FirebaseMessaging.onMessageOpenedApp.listen((m) {",
      "  if (m.data['source'] == 'nestconnect') {",
      "    showNestMessenger(context, chat: chat);",
      "  }",
      "});",
      "",
      "// Android 8+ drops a notification with no channel, silently.",
      "// Create one with this exact id:  nest_messages",
    ].join("\n"),
    blocked: hasPushCredential
      ? undefined
      : "No Firebase service-account key on this channel yet, so nothing will be pushed. Add it under Notifications above — it has to be your app's own Firebase project.",
  };
}

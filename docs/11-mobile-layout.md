# Mobile layout: what breaks, and how we know it's fixed

This document exists because one screen — the thread — was shipped broken four
times in a row, each time with a confident explanation that turned out to be
wrong. It is here so the next person (or the next session) starts from what was
actually established rather than from the same three guesses.

---

## 1. What the user saw

On a Galaxy phone, in a real EAS build:

- the chat header sat *under* the status bar, overlapping the clock;
- the composer sat *under* the navigation bar, half off the screen;
- then, after a fix: the composer at the **top** of the screen with no messages
  visible at all;
- and with one message in a thread the composer floated halfway up the screen,
  while with many it disappeared off the bottom.

None of it reproduced in a browser.

## 2. The wrong explanations, in order

Recorded because each one looked right, and rediscovering them costs a day.

1. **"`mt-auto` isn't supported."** Theorised in turn that Tailwind doesn't emit
   it, that NativeWind doesn't translate it, and that Yoga doesn't honour auto
   margins. All three were tested directly. All three were false — Tailwind emits
   `margin-top: auto`, NativeWind translates it, Yoga honours it. The sheet was
   moved to a `justify-end` root anyway because that pattern was already proven
   on the device; the original `mt-auto` failure has never been reproduced off
   the phone and remains unexplained.

2. **"`KeyboardProvider` is eating the WindowInsets."** A plausible Android story
   about a provider consuming insets before `SafeAreaProvider` sees them. A
   build stamp was added (`src/components/BuildStamp.tsx`) that renders the
   top/bottom inset from every source at once. It reported `35.56` / `48` on
   every source, on the phone, in the broken build. **The insets were never
   zero.** Two commits had been aimed at a problem that did not exist.

3. **"The `cssInterop` registration on `KeyboardAvoidingView` is eating the
   style."** The most convincing one, and the closest to true — a registered
   component's computed props do override the ones its call site passes (see
   `src/animated.ts`). But removing the registration **did not fix the screen**.
   The composer was still pinned to the top on the next build.

## 3. What actually fixed it

Taking `KeyboardAvoidingView` out of the layout path.

```tsx
<View style={{ flex: 1 }}>          {/* owns the screen */}
  <Header insetTop={insets.top} /> {/* pads itself for the status bar */}
  <ScrollView style={{ flex: 1 }} /> {/* flexes into what's left */}
  <KeyboardAvoidingView behavior="padding">
    <Composer />
    <BottomInset />
  </KeyboardAvoidingView>
</View>
```

Every arrangement that routed the screen's *sizing* through
`KeyboardAvoidingView` came back wrong in a different way: the padding it was
given disappeared, then the flex it was given disappeared, then the message list
flexed into it and came out zero tall. Whatever it does with a style prop, it is
not a thing to hang a layout on.

Given only its real job — adding bottom padding equal to the keyboard, which is
exactly what `behavior="padding"` means — it sizes to its own content, which is
correct rather than something to work around.

Note that `app/sign-in.tsx` *does* use `KeyboardAvoidingView` as its screen root,
with a `ScrollView` inside, and has never misbehaved. The difference is that its
scroller sizes to its content (`contentContainerStyle: { flexGrow: 1,
justifyContent: "center" }`) rather than claiming a bounded region with
`flex: 1`. "Never put a ScrollView inside a KeyboardAvoidingView" would be the
wrong lesson; "don't make a KeyboardAvoidingView responsible for how tall a
sibling scroll region is" is the right one.

## 4. The invariants

For any full-screen scrolling layout in this app:

1. **A plain `View` owns the screen.** Not an avoiding view, not a provider, not
   an animated view. Something whose sizing behaviour is not in question.
2. **A `ScrollView` that is meant to fill a region carries `style={{ flex: 1 }}`
   (or `className="flex-1"`).** `contentContainerStyle` is the padding *inside*
   the scroll and is a different thing — setting only that is the single most
   common version of this bug. Without it the scroller sizes to its content:
   short with one message, taller than the screen with many.
3. **Insets are applied by the component that needs them**, from `useInsets()`
   (`src/insets.ts`), which takes the max of the live provider, the module's
   `initialWindowMetrics`, and Android's `StatusBar.currentHeight`. Not by a
   wrapper several levels up.
4. **`KeyboardAvoidingView` wraps the composer and nothing else.**
5. **Registering a component with `cssInterop` makes the interop's computed props
   authoritative over the call site's** — including `style`. Register only what
   needs `className`, and keep that component's call sites on `className`.

## 5. Why the browser didn't catch any of it

Two reasons, both worth knowing before trusting a web export:

- **react-native-web gives `ScrollView` a shrink that Yoga does not.** An
  unbounded scroller — invariant 2 above — lays out correctly in a browser and
  wrongly on a phone. Confirmed by running the broken commit in both.
- **A browser reports zero safe-area insets**, which is indistinguishable from an
  Android build whose insets are broken. `EXPO_PUBLIC_FAKE_INSETS="40,24"` exists
  for this: it makes the export lay out as though it had system bars.

## 6. The check

```bash
pnpm --filter @ding/mobile check:layout   # also runs in CI
```

`apps/mobile/scripts/check-layout-rules.mjs` enforces invariant 4 — and only
invariant 4 — by reading the source: **a `KeyboardAvoidingView` must not contain
a scroll region that claims a bounded height** (`style={{ flex: 1 }}` or
`className="flex-1"`).

That single rule separates all four real call sites correctly, which is why it's
the rule and not something broader:

| call site | shape | verdict |
| --- | --- | --- |
| `thread/[id].tsx` at `ef6cf12`, `1ad3668` | KAV root, `<ScrollView style={{flex:1}}>` inside | **flagged** |
| `thread/[id].tsx` at `6d3ee6c` onwards | KAV wraps the composer only | clean |
| `sign-in.tsx` | KAV root, but its scroller sizes to content | clean |
| `compose.tsx` | `<KeyboardAvoidingView />` as a bottom spacer | clean |

Verified by running it against each of those commits, not by reasoning about it.

### Why it isn't a rendering test

Because a rendering test was written first, and it didn't work.

A Playwright harness measured the thread screen in a web export at 390×844 with
`EXPO_PUBLIC_FAKE_INSETS` — header position, message-region height, composer
position — with one message and with many. Run against the broken commit
(`1ad3668`, the one photographed with the composer stuck at the top of the
screen), it **passed**, reporting numbers identical to the fixed commit's to the
pixel:

```
header "Harbour Hotel" at 41, messages 87→702 (615 tall), input 756→808 of 844
```

That is §5 stated as sharply as it can be. react-native-web lays this bug out
correctly and has nothing to report. A browser cannot see it; the source can. The
harness was deleted rather than kept as reassurance, because a check that goes
green on the exact regression it was written for is worse than no check.

**So: a clean `check:layout` means this one structural trap is not present. It is
not a statement that the screen renders correctly.** For any structural change to
a mobile screen, still put a build on a phone and look at it.

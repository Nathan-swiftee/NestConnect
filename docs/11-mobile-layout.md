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
5. **A scroll region inside a `<Sheet>` must be able to shrink** —
   `style={{ flexShrink: 1 }}`, its own `maxHeight`, or a fixed-height wrapper.
   The mirror image of invariant 2, and the same root cause: Yoga's `flexShrink`
   default is 0. The sheet panel is capped at 85% of the screen, so a taller
   scroller overflows the cap and is clipped — and a clipped `ScrollView` has a
   frame equal to its content, so it believes there is nowhere to scroll and
   every drag inside it does nothing. That is what "the customer details pop-up
   scrolls sometimes and sometimes doesn't" was: a short contact fits inside the
   cap, a long one is silently frozen.
6. **Registering a component with `cssInterop` makes the interop's computed props
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

`apps/mobile/scripts/check-layout-rules.mjs` enforces three rules by reading the
source. All three are invisible to a browser. The first two are invariants 4 and
5, and they are opposites:

1. **a `KeyboardAvoidingView` must not contain a scroll region that claims a
   bounded height** (`style={{ flex: 1 }}` / `className="flex-1"`);
2. **a scroll region inside a `<Sheet>` must be able to shrink**
   (`flexShrink: 1`, its own `maxHeight`, or a fixed-height wrapper);
3. **an animated style must be alone on its element** — see §7.

Rule 1 separates all four real call sites correctly, which is why it's the rule
and not something broader:

| call site | shape | verdict |
| --- | --- | --- |
| `thread/[id].tsx` at `ef6cf12`, `1ad3668` | KAV root, `<ScrollView style={{flex:1}}>` inside | **flagged** |
| `thread/[id].tsx` at `6d3ee6c` onwards | KAV wraps the composer only | clean |
| `sign-in.tsx` | KAV root, but its scroller sizes to content | clean |
| `compose.tsx` | `<KeyboardAvoidingView />` as a bottom spacer | clean |

Verified by running it against each of those commits, not by reasoning about it.

Rule 2 was checked the same way: with `flexShrink: 1` taken back off the details
sheet's scroller it flags that line, and with it on the whole app is clean. It
also has to leave `ForwardSheet` alone, whose list is bounded by a
`<View className="h-[280px]">` wrapper rather than by anything on the list
itself — so the check looks at the enclosing element too, and a scroller whose
height something else already decides is not flagged.

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

**So: a clean `check:layout` means these structural traps are not present. It is
not a statement that the screen renders correctly.** For any structural change to
a mobile screen, still put a build on a phone and look at it.

## 7. An animated style is the only style on its element

```
On a component `cssInterop` has registered, a `style` array containing a
`useAnimatedStyle` value arrives at the component as that value alone.
Everything else in the array is discarded, and a `className` on the same
element goes with it.
```

Registered means, in practice, everything: `react-native-css-interop` registers
every React Native primitive — `View`, `Text`, `Pressable`, `Image`,
`ScrollView`, `TextInput`, the `Touchable*` family — and `src/animated.ts` adds
`Animated.View`, `Animated.Text` and `Animated.ScrollView` on top. So the rule
applies to every animated element in the app.

This is a bug in `react-native-css-interop@0.2.6`, which ships inside
`nativewind@4.2.6`. `renderComponent` splits the incoming `style` into an
animated part and a static part and then lets the animated part overwrite the
static one on the way out.

It cost four visible defects before it was understood, all in one build:

| symptom | what was lost |
| --- | --- |
| a 44pt column of icons above every inbox row | `SwipeRow`'s panel lost `absolute inset-0` and sat in the flow |
| the microphone was a white glyph on nothing | `HoldToRecord`'s disc lost `h-10 w-10 rounded-full` |
| the reply arrow floated above the bubble | `SwipeToReply`'s arrow lost its `position` and `top` |
| sheets opened over an undimmed screen | `Sheet` and `MessageActions` scrims lost both position and colour |

Each of those rendered correctly in a web export, for the same reason §5 gives:
react-native-web resolves the interop differently. Two of them shipped to a
phone twice.

**The fix is always the same shape: put everything into the one animated style
object and leave the element with no `className` and no second style.** Colours
and sizes read from the theme or from React state are fine inside a worklet —
the babel plugin picks them up as dependencies.

One trap when converting a `className` into numbers: **NativeWind's rem on
native is 14, not 16.** `h-10` is 35, `h-9` is 31.5, `px-6` is 21, `px-4` is 14.
Reaching for the browser value silently resizes the thing being fixed. The
values above were measured through the test harness, not calculated.

`apps/mobile/__tests__/interop-probe.test.tsx` is the measurement. It gives the
same style array to a registered component and to one the interop has never
heard of, so reanimated and Jest are constant across the two and the
registration is the only difference. The unregistered component keeps the static
half; the registered one does not. Run it with:

```bash
pnpm --filter @ding/mobile test   # also runs in CI
```

It is written to fail loudly if an upstream release ever fixes this, since at
that point rule 3 can go.

### The check that failed open

Rule 3 shipped with a hole, and it is worth recording because the failure mode
is the dangerous one: it did not report a false problem, it reported *nothing*
and looked like a pass.

The scanner walks forward from `<Name` tracking brace and quote state to find
the tag's closing `>`. It ran over this comment:

> heavier than the palette**'s** `surface2`

The apostrophe opened a string that never closed, so the walk consumed the rest
of the file and the tag was skipped in silence. Two elements in `TabBar.tsx`
went unchecked, and both were carrying exactly the defect the rule exists to
catch — the sliding pill had no background, size or position, and the tab
labels had no font size, weight or gap. They reached a phone and came back as
"I want a background on the active one" and "the text can be smaller and closer
to the icon", which is to say: the design was right in the source the whole
time and was being thrown away before it rendered.

`stripComments` now blanks every comment before anything else reads the source,
preserving offsets so line numbers still point at the right place. The script
also runs the scanner against a specimen containing that exact apostrophe on
every invocation, and refuses to report a pass if it comes back empty.

## 8. Android's blur needs a target, and says nothing without one

```
On Android, expo-blur does not blur "whatever is behind this view". It blurs a
*nominated subtree*, passed as `blurTarget`. Given none, the native view sets
its blur method to NONE and renders a plain panel — no warning, no error.
```

From `ExpoBlurView.kt`:

```kotlin
val safeMethod = if (blurTarget != null) method else BlurMethod.NONE
```

So `blurMethod="dimezisBlurView"` on its own does nothing at all. The tab bar
carried it for weeks and was reported three times as "still properly white, not
glass at all" — correctly, because there was never a blur running to tune. Every
adjustment to `intensity`, `tint` and the wash over it was tuning a parameter of
something that was not happening.

The fix is in two places, and both are needed:

- `app/(app)/(tabs)/_layout.tsx` wraps the screens in a `<BlurTargetView>` and
  hands its ref to the bar. The bar sits *inside* that subtree, which is the
  library's intended arrangement — the native view skips its own drawing while
  it captures, so it cannot photograph itself.
- `TabBar.tsx` passes that ref as `blurTarget`.

### A blur is a photograph, not a veil

The second half of the same bug, and worth stating separately because it will
catch the next glass surface too. The capsule carried `backgroundColor:
c.surface` — solid white — with the `BlurView` filling it, on the reasoning that
Android needs a colour under an elevation to draw a shadow and the blur would
cover it anyway.

A blur does not cover what is behind it. It *photographs* it. An opaque
background inside a blurred container is the thing the blur will show you
instead of your content, so the glass was a photograph of a white rectangle.

That also means **an Android elevation shadow and a real blur cannot coexist on
one view**: the shadow is cast from the view's outline, the outline comes from
its background, and any background is what the blur will render. Glass surfaces
get a hairline ring instead, which is what draws the edge on real glass anyway.

### The target has to arrive twice

Wrapping the screens in a `BlurTargetView` and passing the ref is not enough,
and this cost a whole extra round. From `BlurView.js`:

```js
componentDidMount() { this._updateBlurTargetId(); }
componentDidUpdate(prev) {
  if (prev.blurTarget?.current !== this.props.blurTarget?.current) { … }
}
```

Two things defeat it together. React attaches refs bottom-up, so the `BlurView`
— a descendant of the target — mounts and reads `.current` while the ancestor's
ref is still `null`. And the update guard reads `.current` from
`prevProps.blurTarget` and from `props.blurTarget`, which for a `useRef` is the
*same object*: the two readings are always identical, so the guard can never
fire and the id is never filled in afterwards.

The prop's **identity** has to change once the target attaches. Gating it on
state (`blurTarget={attached ? ref : undefined}`, with `attached` set from the
target's `onLayout`) makes the transition `undefined` → ref, which the guard can
see.

Everything downstream of this was being tuned blind. Four separate passes at
`intensity` and the wash — 44, 60, 84, 48 — were each chosen by looking at a bar
that had no blur running at all, so each was really a guess about how white to
make an opaque panel. Do not tune a glass surface until you can confirm the blur
is on.

## 9. Never gate a control's visibility on a measurement

The tab bar's pill carried its position *and* its opacity on a handshake: every
tab reported its frame through `onLayout` into a `slots` shared value, and a
second shared value held the pill at `opacity: 0` until two frames had landed.
Rendered through the native path, the pill came out with its full box, radius
and background colour, and `opacity: 0`.

It had never been visible on a device. The travelling pill this file is built
around, the spring, the mid-flight stretch — none of it had ever been seen, and
three rounds of feedback about the nav bar were partly about that.

The tabs are `flex: 1` in a row whose width is known from
`useWindowDimensions()`, so every centre is arithmetic:

```
rowW      = screenW − 2·INSET − 2·hairline
slotW     = (rowW − 2·PAD_X) / tabCount
centre(i) = PAD_X + slotW·(i + 0.5)
```

No shared value, no effect, no opacity gate — and note that the first attempt at
this fix moved the wait into a `useEffect` instead of removing it, which
`__tests__/tabbar.test.tsx` caught by still reporting `translateX: 0`. The
values are captured straight into the worklet from the render scope, so they
exist the moment it does. A single `onLayout` on the row remains as a
*correction* if the computed width is ever wrong; it can no longer hide
anything.


### It crashed anyway, and the blur is gone

The `blurTarget` fix above is correct — it is what makes the blur run at all —
and it is also what took the app down. The build that first registered the
target crashed on launch, every time, before first paint.

The first theory was the blur radius. `intensity / blurReductionFactor` had been
set to 70/2 = 35, and `ScriptIntrinsicBlur.setRadius` accepts `0 < r <= 25` and
throws above it; the value had been harmless only because no blur was running to
apply it. That was a real mistake and worth fixing, **but it was not the crash**:
the next build put the factor back to 4, moved to `dimezisBlurViewSdk31Plus` so
Android 12+ uses `RenderEffect` (which has no radius ceiling at all), and it
crashed identically.

So the blur is out of `TabBar.tsx` entirely, and `BlurTargetView` with it. Three
builds, one clean A/B: with the blur wired up the app does not start, without it
the app is fine. A navigation bar is not worth an app that will not open.

**Do not reach for `expo-blur` here again without a crash log first.** Everything
above this line is knowledge worth keeping — the target requirement, the
identity-comparison bug in `componentDidUpdate`, the fact that a blur
photographs what is behind it rather than covering it. None of it identified the
actual fault, because a native crash cannot be diagnosed from the JavaScript
side. The app already carries Sentry (`src/telemetry.ts`); it only initialises
when `EXPO_PUBLIC_SENTRY_DSN` is set at build time, so setting that in the EAS
profile is the cheapest way to turn the next native crash into a stack trace
instead of another round of guessing.

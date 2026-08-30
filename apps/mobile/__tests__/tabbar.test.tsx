/**
 * The tab bar's selected-tab pill, rendered through the native path.
 *
 * This exists because of what it caught. The pill's position and its visibility
 * both used to hang on a measurement handshake — every tab reported its frame
 * through `onLayout` into a shared value, and a second shared value held the
 * pill at `opacity: 0` until two of them had landed. Rendered here, the pill
 * came out with its full box, its radius and its background colour, and:
 *
 *     opacity: 0
 *
 * Nothing on a phone ever showed it, and the travelling pill the whole file is
 * built around had never once been seen. The geometry is arithmetic now — the
 * tabs are `flex: 1` in a row of known width — so there is nothing to wait for.
 *
 * What this asserts is exactly that: the pill arrives ready to be seen, with no
 * frame in which it is invisible or unplaced.
 */
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 24, bottom: 16, left: 0, right: 0 } },
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
}));
// The bar reads its own position from the URL now rather than being handed
// navigator state, so the router has to answer.
// `mock`-prefixed so jest's out-of-scope guard allows the factory to close
// over it — the test needs to move the app between tabs between renders.
const mockSegments: { at: string[] } = { at: ["(app)", "(tabs)"] };
jest.mock("expo-router", () => ({
  useSegments: () => mockSegments.at,
  router: { navigate: () => {} },
}));
import { render } from "nativewind/dist/test";
import "../src/animated";
import { TabBar } from "../src/components/TabBar";

const TABS = [
  { name: "index", label: "Inbox", href: "/", icon: () => null },
  { name: "customers", label: "Customers", href: "/customers", icon: () => null },
  { name: "settings", label: "Settings", href: "/settings", icon: () => null },
];

/** Put the app on one of the tabs, the way a URL would. */
function at(index: number) {
  mockSegments.at = index === 0 ? ["(app)", "(tabs)"] : ["(app)", "(tabs)", TABS[index].name];
}

/** Everything the element is styled by, flattened across both channels —
 *  reanimated's Jest shim splits static and animated halves. */
function styleOf(p: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const walk = (s: unknown) => {
    if (!s || typeof s !== "object") return;
    if (Array.isArray(s)) return s.forEach(walk);
    Object.assign(out, s as object);
  };
  walk(p.jestInlineStyle);
  walk(p.style);
  return out;
}

/**
 * The pill is two views now — an animated one carrying opacity and transform,
 * and a plain child carrying the box — so this reads both. Keeping layout
 * properties out of the animated style is the point, so the split is asserted
 * rather than flattened away.
 */
async function pill(activeIndex: number) {
  at(activeIndex);
  const r = await render(<TabBar tabs={TABS} />, { config: { safelist: [] } });
  const el = r.getByTestId("tabbar-pill");
  const animated = styleOf(el.props as Record<string, unknown>);
  const children = (el.props as { children?: unknown }).children;
  const child = (Array.isArray(children) ? children[0] : children) as
    | { props?: { style?: Record<string, unknown> } }
    | undefined;
  return { animated, box: child?.props?.style ?? {} };
}

/** The pill's travel, off the animated style. */
const translateX = (s: Record<string, unknown>) =>
  (s.transform as { translateX?: number }[])?.find((t) => "translateX" in t)?.translateX ?? 0;

describe("the tab bar's selected-tab pill", () => {
  it("is visible on the very first render, with no measurement to wait for", async () => {
    const { animated, box } = await pill(0);
    // The assertion that matters. Everything below it was already true when the
    // pill was invisible.
    expect(animated.opacity).toBe(1);
    expect(box.backgroundColor).toBe("rgba(26,26,24,0.085)");
    // Sized from the destination rather than fixed, so the assertion is that
    // it is big enough to sit behind an icon *and* its label — the shape it
    // had when it covered only the glyph is what "doesn't cover the tab with
    // the text" was.
    expect(box.width as number).toBeGreaterThan(60);
    expect(box.height).toBe(42);
    expect(box.position).toBe("absolute");
  });

  it("keeps layout properties out of the animated style", async () => {
    // Reanimated drove the box and the transform through one updater for two
    // builds, which is layout going through the shadow tree on every frame
    // alongside compositor-only work. The first build in which that
    // combination actually ran is the first build that crashed on launch.
    const { animated } = await pill(0);
    for (const layout of ["width", "height", "position", "top", "left", "borderRadius"]) {
      expect(animated[layout]).toBeUndefined();
    }
    expect(animated.transform).toBeDefined();
  });

  it("sits over a different tab depending on which is selected", async () => {
    const first = (await pill(0)).animated;
    const last = (await pill(2)).animated;
    // Both placed, and not in the same place — the pill travels rather than
    // sitting at x=0 for want of a frame that never arrived.
    expect(translateX(first)).toBeGreaterThan(0);
    expect(translateX(last)).toBeGreaterThan(translateX(first));
  });

  /**
   * The assertion the old one was missing.
   *
   * "Sits over a different tab" is equally true of a pill that is over the right
   * tab and one that is uniformly six points to the right of every tab, which is
   * exactly what shipped: splitting the box out of the animated style left the
   * animated view in flow at the row's content origin, and both the box's `top`
   * and the worklet's `cx` went on adding that origin a second time. So this
   * checks the pill is *centred on its slot*, which is the property that was
   * actually broken.
   *
   * Everything here is arithmetic the component does from a known window width,
   * so it can be recomputed rather than measured — and stepping it across every
   * tab catches a constant offset, which comparing two tabs to each other cannot.
   */
  it("is centred on the tab it marks, at every tab", async () => {
    // Mirrors the component: INSET 12 either side, one hairline of border per
    // side, then PAD_X 6 of padding inside the capsule.
    const { width } = jest.requireActual("react-native").Dimensions.get("window");
    const { StyleSheet } = jest.requireActual("react-native");
    const rowW = width - 12 * 2 - StyleSheet.hairlineWidth * 2;
    const slotW = (rowW - 6 * 2) / TABS.length;

    for (let i = 0; i < TABS.length; i++) {
      const { animated, box } = await pill(i);
      // The box straddles the anchor so the stretch pivots on the pill's middle,
      // so its own centre is at `left + width / 2` ≈ 0 …
      const boxCentre = (box.left as number) + (box.width as number) / 2;
      expect(boxCentre).toBeCloseTo(0, 6);
      // … and the transform is what puts that centre on the tab's centre.
      expect(translateX(animated)).toBeCloseTo(slotW * (i + 0.5), 6);
    }
  });

  /**
   * The vertical half of the same fault, asserted separately because it had a
   * separate symptom: the pill sat flush with the bottom of the capsule with
   * twice the gap above it.
   *
   * The capsule's padding is the pill's margin, and the anchor already carries
   * it — so the box starts at its parent's top, not at `PAD_Y` again.
   */
  it("starts at the top of the row's content, not a second padding down", async () => {
    const { box } = await pill(0);
    expect(box.top).toBe(0);
    // 30 for the icon's box + 12 for the label's line box: the item, exactly.
    expect(box.height).toBe(42);
  });
});

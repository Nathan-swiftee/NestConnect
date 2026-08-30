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
import { render } from "nativewind/dist/test";
import "../src/animated";
import { TabBar } from "../src/components/TabBar";

const routes = [
  { key: "index-1", name: "index", params: undefined },
  { key: "customers-1", name: "customers", params: undefined },
  { key: "settings-1", name: "settings", params: undefined },
];

/** The minimum a bottom-tab navigator hands its bar. */
function props(activeIndex: number): React.ComponentProps<typeof TabBar> {
  return {
    state: {
      index: activeIndex,
      routes,
      type: "tab",
      key: "tab-1",
      routeNames: routes.map((r) => r.name),
      history: [],
      stale: false,
    },
    descriptors: Object.fromEntries(
      routes.map((r) => [r.key, { options: { title: r.name, tabBarIcon: () => null } }]),
    ),
    navigation: { emit: () => ({ defaultPrevented: false }), navigate: () => {} },
  } as unknown as React.ComponentProps<typeof TabBar>;
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
  const r = await render(<TabBar {...props(activeIndex)} />, { config: { safelist: [] } });
  const el = r.getByTestId("tabbar-pill");
  const animated = styleOf(el.props as Record<string, unknown>);
  const children = (el.props as { children?: unknown }).children;
  const child = (Array.isArray(children) ? children[0] : children) as
    | { props?: { style?: Record<string, unknown> } }
    | undefined;
  return { animated, box: child?.props?.style ?? {} };
}

describe("the tab bar's selected-tab pill", () => {
  it("is visible on the very first render, with no measurement to wait for", async () => {
    const { animated, box } = await pill(0);
    // The assertion that matters. Everything below it was already true when the
    // pill was invisible.
    expect(animated.opacity).toBe(1);
    expect(box.backgroundColor).toBe("rgba(26,26,24,0.085)");
    expect(box.width).toBe(54);
    expect(box.height).toBe(30);
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
    const x = (s: Record<string, unknown>) =>
      (s.transform as { translateX?: number }[])?.find((t) => "translateX" in t)?.translateX ?? 0;
    // Both placed, and not in the same place — the pill travels rather than
    // sitting at x=0 for want of a frame that never arrived.
    expect(x(first)).toBeGreaterThan(0);
    expect(x(last)).toBeGreaterThan(x(first));
  });
});

/**
 * Android keeps what it has.
 *
 * The slot exists for a UIKit rule — a view controller presents one thing at a
 * time — and Android has no equivalent: a modal there is a window, two can be
 * up at once, and the sheets that open other sheets have always worked. Making
 * Android wait for a hand-off would slow down the platform that was never
 * broken, so the slot is bypassed there entirely.
 *
 * Its own file because the platform has to be settled before `modal-slot` is
 * imported, and `jest.mock` is hoisted above the imports for exactly that.
 */
jest.mock("react-native/Libraries/Utilities/Platform", () => ({
  __esModule: true,
  default: { OS: "android", select: (o: Record<string, unknown>) => o.android ?? o.default },
}));

import { act, render } from "@testing-library/react-native";
import { Platform, Text } from "react-native";
import { useModalSlot, __resetModalSlot } from "../src/modal-slot";

const EXIT = 260;

function FakeSheet({ visible, label }: { visible: boolean; label: string }) {
  const { mounted } = useModalSlot(visible, EXIT);
  return mounted ? <Text>{label}</Text> : null;
}

function Pair({ open }: { open: "a" | "b" }) {
  return (
    <>
      <FakeSheet visible={open === "a"} label="sheet-a" />
      <FakeSheet visible={open === "b"} label="sheet-b" />
    </>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  __resetModalSlot();
});
afterEach(() => {
  act(() => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

it("is running as Android", () => {
  // Without this the file would pass by testing iOS twice.
  expect(Platform.OS).toBe("android");
});

it("does not make the second sheet wait", () => {
  const view = render(<Pair open="a" />);
  act(() => {
    view.rerender(<Pair open="b" />);
  });
  // Up immediately, alongside the one still animating out — which is what
  // Android has always done, and what works there.
  expect(view.queryByText("sheet-b")).not.toBeNull();
});

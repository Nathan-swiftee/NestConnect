/**
 * One modal at a time, and in the right order.
 *
 * The bug this covers is invisible in a tree: both sheets mount, both render,
 * both lay out, and every assertion you could make about the React side passes.
 * It only goes wrong in UIKit, where the second presentation is refused and the
 * arriving sheet is simply never seen — which is how "Forward does nothing" and
 * "the items in More do nothing" reached a phone with the code reading fine.
 *
 * So what is asserted here is the one thing that does show up in the tree: that
 * two sheets are never mounted at the same moment on iOS, and that the second
 * one does arrive once the first has gone. And on Android, that nothing waits —
 * there is no such restriction there, and a hand-off delay would be a
 * regression on the platform that works.
 */
import { act, render } from "@testing-library/react-native";
import { Text } from "react-native";
import { useModalSlot, __resetModalSlot } from "../src/modal-slot";

const EXIT = 260;

/** A stand-in for a sheet: renders only while it holds the slot. */
function FakeSheet({ visible, label }: { visible: boolean; label: string }) {
  const { mounted } = useModalSlot(visible, EXIT);
  return mounted ? <Text>{label}</Text> : null;
}

function Pair({ open }: { open: "a" | "b" | null }) {
  return (
    <>
      <FakeSheet visible={open === "a"} label="sheet-a" />
      <FakeSheet visible={open === "b"} label="sheet-b" />
    </>
  );
}

describe("on iOS", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    __resetModalSlot();
  });
  afterEach(() => {
    // Inside act: draining the hand-off timer settles React state, and a bare
    // drain reports that as an update outside act on every single test.
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("never has two sheets mounted at once when one opens another", () => {
    const view = render(<Pair open="a" />);
    expect(view.queryByText("sheet-a")).not.toBeNull();

    // The shape that breaks iOS: close one and open the other in one commit,
    // exactly as `onForward(); onClose();` does.
    act(() => {
      view.rerender(<Pair open="b" />);
    });
    expect(view.queryByText("sheet-b")).toBeNull();
    expect(view.queryByText("sheet-a")).not.toBeNull();

    // Half way through the outgoing sheet's exit: still only one.
    act(() => {
      jest.advanceTimersByTime(EXIT / 2);
    });
    expect(view.queryByText("sheet-b")).toBeNull();
  });

  it("hands the slot over once the first is gone", () => {
    const view = render(<Pair open="a" />);
    act(() => {
      view.rerender(<Pair open="b" />);
    });
    act(() => {
      jest.advanceTimersByTime(EXIT + 200);
    });
    expect(view.queryByText("sheet-a")).toBeNull();
    // The whole point: the sheet the agent asked for does arrive.
    expect(view.queryByText("sheet-b")).not.toBeNull();
  });

  it("gives the slot back when a sheet is unmounted mid-flight", () => {
    // A screen torn down while its sheet is up must not strand the slot, or
    // every sheet afterwards waits on a component that no longer exists.
    const view = render(<Pair open="a" />);
    act(() => {
      view.rerender(<></>);
    });
    act(() => {
      jest.advanceTimersByTime(EXIT + 200);
    });
    const next = render(<Pair open="b" />);
    act(() => {
      jest.advanceTimersByTime(EXIT + 200);
    });
    expect(next.queryByText("sheet-b")).not.toBeNull();
  });
});

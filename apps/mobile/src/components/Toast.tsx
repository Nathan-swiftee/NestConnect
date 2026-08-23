import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Pressable, Text } from "react-native";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ReduceMotion } from "react-native-reanimated";
import { AlertIcon, CheckCircleIcon, ReopenIcon } from "../icons";
import { haptics } from "../haptics";
import { useTheme } from "../theme";
import { timing } from "../motion";

/**
 * Confirmation for actions that don't visibly change the screen.
 *
 * Assigning, snoozing and resolving all happen inside a sheet. The sheet closes,
 * and the thread underneath looks exactly as it did — so the only evidence the
 * action landed is a line of subtitle text two taps away. That reads as a
 * button that didn't work, and the natural response is to do it again.
 *
 * A toast is the smallest thing that fixes it: it says what happened, in the
 * words of the thing that happened ("Snoozed until tomorrow, 9 AM", not
 * "Success"), and then leaves.
 *
 * **Undo is the point, where it exists.** Assign and snooze are one tap away
 * from being wrong, and the toast is the only moment the previous state is
 * still known. Actions that can be reversed pass an `undo`, and those toasts
 * stay up longer — there is no use offering a way back that expires before it's
 * read.
 *
 * It sits at the bottom because that's where the action was: sheets rise from
 * there, and the confirmation arriving in the same place is continuous with the
 * gesture that caused it. Above the safe area, and above the composer, which it
 * briefly overlaps — it's transient, and the alternative is reserving a strip of
 * a phone screen permanently for something that's usually not there.
 */
type Tone = "success" | "error" | "info";

type ToastRequest = {
  text: string;
  tone?: Tone;
  /** Reverses the action. Shown as a button, and extends how long this stays up. */
  undo?: () => void;
};

type Toast = ToastRequest & { id: number };

const ToastContext = createContext<(t: ToastRequest) => void>(() => {});

/** Raise a toast. Safe to call from anywhere below the provider. */
export function useToast(): (t: ToastRequest) => void {
  return useContext(ToastContext);
}

/** Long enough to read the sentence; longer if there's a decision attached. */
const PLAIN_MS = 3200;
const UNDO_MS = 6000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((t: ToastRequest) => {
    // Newest wins rather than queueing. Two actions in a row means the second
    // one is what the agent is thinking about; making them wait through the
    // first toast to see it confirms the wrong thing.
    seq.current += 1;
    setToast({ ...t, id: seq.current });
  }, []);

  useEffect(() => {
    if (!toast) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), toast.undo ? UNDO_MS : PLAIN_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? <Bar key={toast.id} toast={toast} onDismiss={() => setToast(null)} /> : null}
    </ToastContext.Provider>
  );
}

function Bar({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const tone = toast.tone ?? "success";

  const Icon = tone === "error" ? AlertIcon : tone === "info" ? ReopenIcon : CheckCircleIcon;
  const accent = tone === "error" ? c.danger : tone === "info" ? c.textMuted : c.brand;

  return (
    <Animated.View
      // Rises from where the sheet went, and leaves the same way.
      entering={SlideInDown.springify().damping(24).stiffness(200).mass(1).reduceMotion(ReduceMotion.System)}
      exiting={SlideOutDown.duration(timing.base.duration).reduceMotion(ReduceMotion.System)}
      pointerEvents="box-none"
      style={{ bottom: insets.bottom + 12 }}
      className="absolute inset-x-3 z-50"
    >
      <Pressable
        onPress={onDismiss}
        accessibilityRole="alert"
        accessibilityLabel={toast.text}
        // The whole bar dismisses, so it never sits in the way of the thing
        // underneath it. The undo button stops the press from reaching here.
        style={{
          backgroundColor: c.elevated,
          borderColor: c.border,
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        }}
        className="flex-row items-center gap-2.5 rounded-16 border px-3.5 py-3 active:opacity-90"
      >
        <Icon size={18} color={accent} />
        <Text numberOfLines={2} className="flex-1 text-md font-medium text-fg">
          {toast.text}
        </Text>
        {toast.undo ? (
          <Pressable
            onPress={() => {
              haptics.tap();
              toast.undo?.();
              onDismiss();
            }}
            accessibilityRole="button"
            accessibilityLabel="Undo"
            hitSlop={10}
            className="px-1 active:opacity-60"
          >
            <Text style={{ color: c.brand }} className="text-md font-semibold">
              Undo
            </Text>
          </Pressable>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

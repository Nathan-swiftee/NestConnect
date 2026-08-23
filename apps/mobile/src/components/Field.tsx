import { forwardRef } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";
import { useTheme } from "../theme";

/**
 * A labelled text field. The label is a real `<Text>` above the input rather
 * than a placeholder, so it survives typing — a placeholder-as-label leaves
 * someone who's been interrupted with no idea what the field was.
 *
 * The label is also handed to the input as its accessible name, and the error
 * as its hint. Sighted users get the association for free from the layout; a
 * screen reader gets nothing from proximity, and without this it announces an
 * unnamed text field and then, separately, a piece of text that happens to sit
 * near it — which is how a sign-in form becomes unusable with VoiceOver on.
 */
export const Field = forwardRef<TextInput, TextInputProps & { label: string; error?: string }>(
  function Field({ label, error, ...props }, ref) {
    const { c } = useTheme();
    return (
      <View className="gap-2">
        {/* The visible label is decorative to a reader — the input carries the
            same words as its name, and announcing them twice is noise. */}
        <Text accessibilityElementsHidden importantForAccessibility="no" className="text-sm font-medium text-muted">
          {label}
        </Text>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={error}
          placeholderTextColor={c.textFaint}
          style={{ color: c.text, borderColor: error ? c.danger : c.border, backgroundColor: c.surface2 }}
          className="rounded-12 border px-4 py-3.5 text-lg"
          {...props}
        />
        {error ? (
          // Announced live, because the person who needs it may have moved on
          // to the next field by the time it appears.
          <Text accessibilityLiveRegion="polite" className="text-sm text-danger">
            {error}
          </Text>
        ) : null}
      </View>
    );
  },
);

import { forwardRef } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";
import { useTheme } from "../theme";

/**
 * A labelled text field. The label is a real `<Text>` above the input rather
 * than a placeholder, so it survives typing — a placeholder-as-label leaves
 * someone who's been interrupted with no idea what the field was.
 */
export const Field = forwardRef<TextInput, TextInputProps & { label: string; error?: string }>(
  function Field({ label, error, ...props }, ref) {
    const { c } = useTheme();
    return (
      <View className="gap-2">
        <Text className="text-sm font-medium text-muted">{label}</Text>
        <TextInput
          ref={ref}
          placeholderTextColor={c.textFaint}
          style={{ color: c.text, borderColor: error ? c.danger : c.border, backgroundColor: c.surface2 }}
          className="rounded-12 border px-4 py-3.5 text-lg"
          {...props}
        />
        {error ? <Text className="text-sm text-danger">{error}</Text> : null}
      </View>
    );
  },
);

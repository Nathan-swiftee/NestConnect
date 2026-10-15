import { Fragment } from "react";
import { Linking, Text } from "react-native";
import { linkParts } from "@ding/schemas";
import { useTheme } from "../theme";

/**
 * Text with the links in it tappable: web addresses (with or without
 * "https://") and email addresses. See `linkParts` for what counts.
 *
 * Nested `Text`, not a `Pressable`, so a link wraps with the sentence around it
 * instead of breaking the line — and so it has to sit inside a `Text` itself.
 * A long-press still reaches the bubble's own menu.
 */
export function LinkedText({ text }: { text: string }) {
  const { scheme } = useTheme();
  const parts = linkParts(text);
  if (parts.length === 1 && !parts[0]!.href) return <>{text}</>;
  const color = scheme === "dark" ? "#53BDEB" : "#027EB5";
  return (
    <>
      {parts.map((p, i) =>
        p.href ? (
          <Text
            key={i}
            onPress={() => void Linking.openURL(p.href!).catch(() => {})}
            accessibilityRole="link"
            style={{ color, textDecorationLine: "underline" }}
          >
            {p.text}
          </Text>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

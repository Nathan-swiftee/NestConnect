import { Text, View } from "react-native";
import { avatarBg, initials } from "@ding/client";

/**
 * The same coloured-initials avatar the web shows — same palette, same hash, so
 * a contact is the same colour on both. `size` is the diameter in px; the type
 * scales with it so the initials stay optically centred at any size.
 */
export function Avatar({ name, color, size = 52 }: { name: string; color?: string | null; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: avatarBg(name, color) }}
      className="items-center justify-center"
    >
      <Text style={{ fontSize: size * 0.36, lineHeight: size * 0.44 }} className="font-semibold text-white">
        {initials(name)}
      </Text>
    </View>
  );
}

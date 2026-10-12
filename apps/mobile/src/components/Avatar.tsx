import { useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import { avatarBg, initials } from "@ding/client";

/**
 * The same coloured-initials avatar the web shows — same palette, same hash, so
 * a contact is the same colour on both. `size` is the diameter in px; the type
 * scales with it so the initials stay optically centred at any size.
 */
export function Avatar({
  name,
  color,
  size = 52,
  photo,
}: {
  name: string;
  color?: string | null;
  size?: number;
  /**
   * An uploaded profile photo, as an image source — pass `mediaSource(user.avatarUrl)`,
   * which carries the session. Initials show if it can't load.
   */
  photo?: { uri: string; headers?: Record<string, string> } | null;
}) {
  const [failed, setFailed] = useState(false);
  if (photo && !failed) {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: avatarBg(name, color), overflow: "hidden" }}>
        <Image
          source={photo}
          style={{ width: size, height: size }}
          contentFit="cover"
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
          onError={() => setFailed(true)}
        />
      </View>
    );
  }
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

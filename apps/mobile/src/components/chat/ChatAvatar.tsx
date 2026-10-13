import { Text, View } from "react-native";
import { avatarBg, initials, useTeams } from "@ding/client";
import type { ChatRoomSummary } from "@ding/schemas";
import { mediaSource } from "../../api-config";
import { TeamGlyph } from "../../icons";
import { useTheme } from "../../theme";
import { Avatar } from "../Avatar";

/**
 * A chat's face: the person, for a direct chat (with a green dot while they're
 * online); the group's emoji, or its initials; the team's own icon. The same
 * rules as the web's RoomAvatar.
 */
export function ChatAvatar({ room, size = 48 }: { room: Pick<ChatRoomSummary, "kind" | "name" | "emoji" | "teamId" | "other">; size?: number }) {
  const { c } = useTheme();
  const teams = useTeams();
  const round = { width: size, height: size, borderRadius: size / 2 };

  if (room.kind === "direct" && room.other) {
    const o = room.other;
    return (
      <View style={{ width: size, height: size }}>
        <Avatar name={o.name} color={o.avatarColor} size={size} photo={o.avatarUrl ? mediaSource(o.avatarUrl) : null} />
        {o.online ? (
          <View
            accessibilityLabel="Online"
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: Math.max(10, size * 0.27),
              height: Math.max(10, size * 0.27),
              borderRadius: size,
              backgroundColor: "#25D366",
              borderWidth: 2,
              borderColor: c.bg,
            }}
          />
        ) : null}
      </View>
    );
  }
  if (room.kind === "team") {
    const icon = (teams.data ?? []).find((t) => t.id === room.teamId)?.icon;
    return (
      <View style={[round, { backgroundColor: c.brandTint }]} className="items-center justify-center">
        <TeamGlyph icon={icon} size={size * 0.5} color={c.brandStrong} />
      </View>
    );
  }
  if (room.emoji) {
    return (
      <View style={[round, { backgroundColor: c.surface2 }]} className="items-center justify-center">
        <Text style={{ fontSize: size * 0.5, lineHeight: size * 0.62 }}>{room.emoji}</Text>
      </View>
    );
  }
  return (
    <View style={[round, { backgroundColor: avatarBg(room.name) }]} className="items-center justify-center">
      <Text style={{ fontSize: size * 0.36, color: "#fff", fontWeight: "700" }}>{initials(room.name)}</Text>
    </View>
  );
}

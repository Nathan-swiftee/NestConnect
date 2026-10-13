import type { ChatRoomSummary } from "@ding/schemas";
import { avatarBg, initials, useTeams } from "../../hooks";
import { TeamGlyph } from "../../lib/icons";
import { Avatar } from "../Avatar";

/**
 * A chat's face: the person, for a direct chat (with a green dot while they're
 * online); the group's emoji, or its initials; the team's own icon.
 */
export function RoomAvatar({ room, size = 40 }: { room: ChatRoomSummary; size?: number }) {
  const teams = useTeams();
  const style = { width: size, height: size };
  if (room.kind === "direct" && room.other) {
    return (
      <span className="tc-av" style={style}>
        <Avatar name={room.other.name} color={room.other.avatarColor} src={room.other.avatarUrl} size={size} fontSize={Math.round(size * 0.36)} />
        {room.other.online && <span className="tc-av__dot" aria-label="Online" />}
      </span>
    );
  }
  if (room.kind === "team") {
    const icon = (teams.data ?? []).find((t) => t.id === room.teamId)?.icon;
    return (
      <span className="tc-av tc-av--team" style={style} aria-hidden="true">
        <TeamGlyph icon={icon} />
      </span>
    );
  }
  if (room.emoji) {
    return (
      <span className="tc-av tc-av--emoji" style={{ ...style, fontSize: Math.round(size * 0.5) }} aria-hidden="true">
        {room.emoji}
      </span>
    );
  }
  return (
    <span className="tc-av tc-av--group" style={{ ...style, background: avatarBg(room.name), fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {initials(room.name)}
    </span>
  );
}

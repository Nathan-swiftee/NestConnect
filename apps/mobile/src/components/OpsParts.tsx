import { Text, View } from "react-native";
import type { OpsSopCard, Team } from "@ding/schemas";
import { tint } from "../ops";
import { useTheme } from "../theme";

/** An SOP's (or collection's) emoji on its own colour. */
export function OpsTile({ icon, color, size = 44 }: { icon: string; color: string; size?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        backgroundColor: tint(color, 0.16),
        borderWidth: 1,
        borderColor: tint(color, 0.28),
      }}
      className="items-center justify-center"
    >
      <Text style={{ fontSize: Math.round(size * 0.5), lineHeight: Math.round(size * 0.62) }}>{icon}</Text>
    </View>
  );
}

type Tone = "neutral" | "brand" | "amber" | "danger" | "solidAmber";

export function OpsChip({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const { c } = useTheme();
  const look: Record<Tone, { bg: string; fg: string }> = {
    neutral: { bg: c.surface2, fg: c.textMuted },
    brand: { bg: c.brandTint, fg: c.brandStrong },
    amber: { bg: c.amberTint, fg: c.amber },
    danger: { bg: c.dangerTint, fg: c.danger },
    solidAmber: { bg: c.amber, fg: "#fff" },
  };
  return (
    <View style={{ backgroundColor: look[tone].bg }} className="rounded-full px-2 py-0.5">
      <Text style={{ color: look[tone].fg }} className="text-2xs font-semibold">
        {label}
      </Text>
    </View>
  );
}

/** Who reads it, as words: "All teams", "Support team", "Support team +1". */
export function teamsLabel(sop: Pick<OpsSopCard, "allTeams" | "teamIds">, teams: Team[]): string {
  if (sop.allTeams) return "All teams";
  const names = sop.teamIds.map((id) => teams.find((t) => t.id === id)?.name).filter(Boolean) as string[];
  if (!names.length) return "No teams yet";
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
}

/** Draft / Archived / Please confirm / Must read / Due for review. */
export function SopFlags({ sop }: { sop: OpsSopCard }) {
  return (
    <>
      {sop.status === "draft" ? <OpsChip label="Draft" /> : null}
      {sop.status === "archived" ? <OpsChip label="Archived" /> : null}
      {sop.needsMyAck ? (
        <OpsChip label="Please confirm" tone="solidAmber" />
      ) : sop.mustRead && sop.status === "published" ? (
        <OpsChip label="Must read" tone="brand" />
      ) : null}
      {sop.reviewOverdue ? <OpsChip label="Due for review" tone="danger" /> : null}
    </>
  );
}

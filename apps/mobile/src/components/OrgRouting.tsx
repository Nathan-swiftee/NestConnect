import { useState } from "react";
import { Text, View } from "react-native";
import { api, useAccountMutation, useMe, usePeople, useTeams } from "@ding/client";
import type { AccountDetail } from "@ding/schemas";
import { useTheme } from "../theme";
import { Choice } from "./OrganisationForms";
import { Touchable } from "./Touchable";
import { useToast } from "./Toast";

/**
 * Where an organisation's people's new chats go — the same card as the web's
 * Routing. Admins and managers change it; everyone sees it. A contact with
 * routing of their own keeps theirs. See docs/organisations.md › Routing.
 */
export function OrgRouting({ d, readOnly }: { d: AccountDetail; readOnly: boolean }) {
  const { c } = useTheme();
  const toast = useToast();
  const a = d.account;
  const me = useMe();
  const canEdit = !readOnly && (me.data?.user.role === "admin" || me.data?.user.role === "manager");
  const teams = useTeams().data ?? [];
  const people = usePeople().data ?? [];
  const [editing, setEditing] = useState(false);
  const [teamId, setTeamId] = useState(a.routeTeamId ?? "");
  const [userId, setUserId] = useState(a.routeUserId ?? "");
  const save = useAccountMutation((v: { teamId: string | null; userId: string | null }) => api.setAccountRouting(a.id, v));
  const teamName = teams.find((t) => t.id === a.routeTeamId)?.name;
  const personName = people.find((p) => p.user.id === a.routeUserId)?.user.name;
  const onTeam = people.filter((p) => teamId && p.teamIds.includes(teamId));
  // Absent from a server that predates routing (the app can update first).
  const { appliesTo, ownRouting, unclear } = d.routing ?? { appliesTo: 0, ownRouting: 0, unclear: 0 };

  return (
    <View className="pt-5">
      <View className="flex-row items-center justify-between px-5 pb-1.5">
        <Text style={{ color: c.textFaint }} className="text-2xs font-semibold uppercase tracking-wider">
          Routing
        </Text>
        {canEdit && !editing ? (
          <Touchable
            feel="chip"
            borderless
            onPress={() => {
              setTeamId(a.routeTeamId ?? "");
              setUserId(a.routeUserId ?? "");
              setEditing(true);
            }}
            accessibilityRole="button"
            hitSlop={10}
          >
            <Text style={{ color: c.brand }} className="text-sm font-semibold">
              {a.routeTeamId ? "Change" : "Set up"}
            </Text>
          </Touchable>
        ) : null}
      </View>
      <View style={{ backgroundColor: c.surface2, borderColor: c.border }} className="mx-4 gap-2 rounded-16 border px-4 py-3">
        {!editing ? (
          <>
            {a.routeTeamId ? (
              <Text className="text-md text-fg">
                New chats go to <Text className="font-semibold">{teamName ?? "a team"}</Text>
                {a.routeUserId ? (
                  <>
                    {" · "}
                    <Text className="font-semibold">{personName ?? "someone"}</Text>
                    <Text className="text-sm text-muted"> (the team takes it while they're away)</Text>
                  </>
                ) : null}
              </Text>
            ) : (
              <Text className="text-md text-muted">Not set — its people's chats follow each channel's own routing.</Text>
            )}
            {a.routeTeamId && d.contacts.length ? (
              <View className="gap-0.5">
                <Text className="text-sm text-muted">{`${appliesTo} of its ${d.contacts.length} ${d.contacts.length === 1 ? "person follows" : "people follow"} this`}</Text>
                {ownRouting ? (
                  <Text className="text-sm text-muted">{`${ownRouting} ${ownRouting === 1 ? "has" : "have"} routing of their own, which comes first`}</Text>
                ) : null}
                {unclear ? (
                  <Text style={{ color: c.amber }} className="text-sm">
                    {`${unclear} ${unclear === 1 ? "is" : "are"} in several organisations that route — set routing on ${unclear === 1 ? "that person" : "those people"} to choose`}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </>
        ) : (
          <View className="gap-3">
            <Choice
              label="Team"
              options={[{ value: "", label: "No routing" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
              value={teamId}
              onChange={(v) => {
                setTeamId(v);
                if (userId && !people.find((p) => p.user.id === userId)?.teamIds.includes(v)) setUserId("");
              }}
            />
            {teamId ? (
              <Choice
                label="Straight to a person (optional)"
                options={[{ value: "", label: "Anyone on the team" }, ...onTeam.map((p) => ({ value: p.user.id, label: p.user.name }))]}
                value={userId}
                onChange={setUserId}
              />
            ) : null}
            <Text className="text-sm text-muted">A contact with routing of their own keeps theirs.</Text>
            <View className="flex-row justify-end gap-2">
              <Touchable feel="chip" onPress={() => setEditing(false)} accessibilityRole="button" className="rounded-full px-4 py-2">
                <Text className="text-md font-medium text-muted">Cancel</Text>
              </Touchable>
              <Touchable
                feel="slab"
                disabled={save.isPending}
                onPress={() =>
                  save.mutate(
                    { teamId: teamId || null, userId: teamId && userId ? userId : null },
                    {
                      onSuccess: () => {
                        setEditing(false);
                        toast({ text: teamId ? "Routing saved" : "Routing switched off" });
                      },
                      onError: (e) => toast({ text: e instanceof Error ? e.message : "Couldn't save", tone: "error" }),
                    },
                  )
                }
                accessibilityRole="button"
                style={{ backgroundColor: c.brand, opacity: save.isPending ? 0.6 : 1 }}
                className="rounded-full px-4 py-2"
              >
                <Text className="text-md font-semibold text-white">Save</Text>
              </Touchable>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

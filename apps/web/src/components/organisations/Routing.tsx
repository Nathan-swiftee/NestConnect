import { useMemo, useState } from "react";
import type { AccountDetail } from "@ding/schemas";
import { api } from "../../lib/api";
import { useAccountMutation, useMe, usePeople, useTeams } from "../../hooks";
import { EditIcon, RouteIcon } from "../../lib/icons";

/**
 * Where this organisation's people's new chats go: a team, and optionally a
 * person on it. A contact with routing of their own keeps theirs; someone in
 * several organisations follows this one only if it's the only one of theirs
 * that routes. Admins and managers change it. See docs/organisations.md.
 */
export function RoutingCard({ d, readOnly, onToast }: { d: AccountDetail; readOnly: boolean; onToast: (m: string) => void }) {
  const a = d.account;
  const me = useMe();
  const canEdit = !readOnly && (me.data?.user.role === "admin" || me.data?.user.role === "manager");
  const teams = useTeams().data ?? [];
  const people = usePeople().data ?? [];
  const [editing, setEditing] = useState(false);
  const [teamId, setTeamId] = useState<string | null>(a.routeTeamId);
  const [userId, setUserId] = useState<string | null>(a.routeUserId);
  const save = useAccountMutation((v: { teamId: string | null; userId: string | null }) => api.setAccountRouting(a.id, v));
  const onTeam = useMemo(() => people.filter((p) => teamId && p.teamIds.includes(teamId)), [people, teamId]);
  const teamName = teams.find((t) => t.id === a.routeTeamId)?.name;
  const personName = people.find((p) => p.user.id === a.routeUserId)?.user.name;
  const { appliesTo, ownRouting, unclear } = d.routing;

  const submit = (v: { teamId: string | null; userId: string | null }) =>
    save.mutate(v, {
      onSuccess: () => {
        setEditing(false);
        onToast(v.teamId ? "Routing saved" : "Routing switched off");
      },
      onError: (e) => onToast((e as Error).message || "Couldn't save the routing"),
    });

  return (
    <section className="org-card org-routing">
      <h3>
        <RouteIcon /> Routing
        {canEdit && !editing && (
          <button
            type="button"
            className="org-linkbtn"
            onClick={() => {
              setTeamId(a.routeTeamId);
              setUserId(a.routeUserId);
              setEditing(true);
            }}
          >
            <EditIcon /> {a.routeTeamId ? "Change" : "Set up"}
          </button>
        )}
      </h3>

      {!editing ? (
        <>
          {a.routeTeamId ? (
            <p className="org-routing__to">
              New chats go to <b>{teamName ?? "a team"}</b>
              {a.routeUserId && (
                <>
                  {" "}· <b>{personName ?? "someone"}</b>
                  <small> (the team takes it while they're away)</small>
                </>
              )}
            </p>
          ) : (
            <p className="org-muted">Not set — its people's chats follow each channel's own routing.</p>
          )}
          {a.routeTeamId && d.contacts.length > 0 && (
            <ul className="org-routing__reach">
              <li><b>{appliesTo}</b> of its {d.contacts.length} {d.contacts.length === 1 ? "person follows" : "people follow"} this</li>
              {ownRouting > 0 && <li>{ownRouting} {ownRouting === 1 ? "has" : "have"} routing of their own, which comes first</li>}
              {unclear > 0 && (
                <li className="org-routing__warn">
                  {unclear} {unclear === 1 ? "is" : "are"} in several organisations that route — set routing on {unclear === 1 ? "that person" : "those people"} to choose
                </li>
              )}
            </ul>
          )}
        </>
      ) : (
        <form
          className="org-routing__form"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ teamId, userId: teamId ? userId : null });
          }}
        >
          <label className="field">
            <span>Team</span>
            <select
              value={teamId ?? ""}
              onChange={(e) => {
                const next = e.target.value || null;
                setTeamId(next);
                if (userId && !people.find((p) => p.user.id === userId)?.teamIds.includes(next ?? "")) setUserId(null);
              }}
            >
              <option value="">No routing</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Straight to a person <em>optional, on that team</em></span>
            <select value={userId ?? ""} disabled={!teamId} onChange={(e) => setUserId(e.target.value || null)}>
              <option value="">Anyone on the team</option>
              {onTeam.map((p) => <option key={p.user.id} value={p.user.id}>{p.user.name}</option>)}
            </select>
          </label>
          <p className="org-muted">A contact with routing of their own keeps theirs. A live-chat menu choice still comes first.</p>
          <div className="org-routing__acts">
            <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={save.isPending}>Save</button>
          </div>
        </form>
      )}
    </section>
  );
}

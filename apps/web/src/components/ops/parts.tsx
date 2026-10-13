import type { FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import type { OpsSopCard, Team } from "@ding/schemas";
import { tint } from "../../lib/ops";
import { XIcon } from "../../lib/icons";

export function errMessage(err: unknown, fallback: string): string {
  return (err as Error)?.message || fallback;
}

/** An SOP's (or collection's) emoji on its own colour. */
export function OpsTile({ icon, color, size = 40 }: { icon: string; color: string; size?: number }) {
  return (
    <span
      className="ops-tile"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5), background: tint(color, 0.16), boxShadow: `inset 0 0 0 1px ${tint(color, 0.28)}` }}
    >
      {icon}
    </span>
  );
}

/** Who reads it: "All teams", or the team names. */
export function TeamChips({ sop, teams, max = 2 }: { sop: Pick<OpsSopCard, "allTeams" | "teamIds">; teams: Team[]; max?: number }) {
  if (sop.allTeams) return <span className="ops-chip ops-chip--teams">All teams</span>;
  const names = sop.teamIds.map((id) => teams.find((t) => t.id === id)?.name).filter(Boolean) as string[];
  if (!names.length) return <span className="ops-chip ops-chip--warn">No teams yet</span>;
  const shown = names.slice(0, max);
  return (
    <>
      {shown.map((n) => (
        <span key={n} className="ops-chip ops-chip--teams">{n}</span>
      ))}
      {names.length > max && <span className="ops-chip ops-chip--teams" title={names.join(", ")}>+{names.length - max}</span>}
    </>
  );
}

/** Draft / Archived / Due for review / Must read — whatever is worth saying on a card. */
export function SopFlags({ sop }: { sop: OpsSopCard }) {
  return (
    <>
      {sop.status === "draft" && <span className="ops-chip ops-chip--draft">Draft</span>}
      {sop.status === "archived" && <span className="ops-chip">Archived</span>}
      {sop.needsMyAck ? (
        <span className="ops-chip ops-chip--ack">Please confirm</span>
      ) : (
        sop.mustRead && sop.status === "published" && <span className="ops-chip ops-chip--must">Must read</span>
      )}
      {sop.reviewOverdue && <span className="ops-chip ops-chip--review">Due for review</span>}
    </>
  );
}

/** The app's modal, portalled, its submit kept to itself. */
export function OpsModal({
  title,
  onClose,
  children,
  foot,
  wide,
  onSubmit,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  foot?: ReactNode;
  wide?: boolean;
  onSubmit?: (e: FormEvent) => void;
}) {
  return createPortal(
    <div className="modal" onClick={onClose}>
      <form
        className={"modal__box modal--form org-form" + (wide ? " org-modal--wide" : "")}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSubmit?.(e);
        }}
      >
        <div className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close"><XIcon /></button>
        </div>
        <div className="modal__body">{children}</div>
        {foot && <div className="modal__foot">{foot}</div>}
      </form>
    </div>,
    document.body,
  );
}

/** "3 months", "1 year" — a review period in words. */
export function periodLabel(months: number): string {
  if (months % 12 === 0) return months === 12 ? "1 year" : `${months / 12} years`;
  return months === 1 ? "1 month" : `${months} months`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

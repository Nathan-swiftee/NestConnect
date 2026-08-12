import type { Label } from "@ding/schemas";
import { useLabels, useSetConversationLabels } from "../hooks";
import { CheckIcon } from "../lib/icons";

/** A checklist of the org's labels with the ones on this conversation ticked.
 *  Toggling a row applies/removes it immediately. Rendered inside a popover by
 *  the caller (the thread header's Tag button and the Details panel). */
export function LabelPicker({ conversationId, current }: { conversationId: string; current: Label[] }) {
  const labels = useLabels();
  const setLabels = useSetConversationLabels();
  const currentIds = new Set(current.map((l) => l.id));

  const toggle = (id: string) => {
    const next = new Set(currentIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setLabels.mutate({ id: conversationId, labelIds: [...next] });
  };

  const list = labels.data ?? [];
  return (
    <div className="labelpick" role="menu" aria-label="Labels">
      {list.length === 0 ? (
        <div className="labelpick__empty">No labels yet — create them in Settings ▸ Labels.</div>
      ) : (
        list.map((l) => {
          const on = currentIds.has(l.id);
          return (
            <button
              key={l.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              className={"labelpick__row" + (on ? " on" : "")}
              onClick={() => toggle(l.id)}
            >
              <span className="labelpick__dot" style={{ background: l.color }} />
              <span className="labelpick__name">{l.name}</span>
              {on && (
                <span className="labelpick__tick" aria-hidden="true">
                  <CheckIcon />
                </span>
              )}
            </button>
          );
        })
      )}
    </div>
  );
}

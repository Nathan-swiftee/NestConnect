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
    <div className="flex flex-col gap-px max-h-[280px] overflow-auto" role="menu" aria-label="Labels">
      {list.length === 0 ? (
        <div className="p-2 text-xs text-muted">No labels yet — create them in Settings ▸ Labels.</div>
      ) : (
        list.map((l) => {
          const on = currentIds.has(l.id);
          return (
            <button
              key={l.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              className={
                "flex items-center gap-2 w-full py-[7px] px-2 rounded-8 text-left text-sm text-fg [transition:background_.12s] hover:bg-surface-2" +
                (on ? " font-[650]" : "")
              }
              onClick={() => toggle(l.id)}
            >
              <span className="shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: l.color }} />
              <span className="flex-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{l.name}</span>
              {on && (
                <span className="flex-none text-brand-strong inline-grid place-items-center [&>svg]:w-[15px] [&>svg]:h-[15px]" aria-hidden="true">
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

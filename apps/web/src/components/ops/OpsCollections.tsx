import { useState } from "react";
import type { OpsCollection } from "@ding/schemas";
import { OPS_COLORS, OPS_ICONS } from "@ding/schemas";
import { api } from "../../lib/api";
import { useOpsMutation } from "../../hooks";
import { errMessage, OpsModal, OpsTile } from "./parts";

/* ------------------------------- collections ------------------------------- */

export function CollectionModal({
  collection,
  onClose,
  onSaved,
  onDeleted,
  onToast,
}: {
  collection: OpsCollection | null;
  onClose: () => void;
  onSaved?: (c: OpsCollection) => void;
  onDeleted?: (id: string) => void;
  onToast: (m: string) => void;
}) {
  const [name, setName] = useState(collection?.name ?? "");
  const [icon, setIcon] = useState(collection?.icon ?? "📁");
  const [color, setColor] = useState(collection?.color ?? OPS_COLORS[1]);
  const save = useOpsMutation(() =>
    collection ? api.updateOpsCollection(collection.id, { name: name.trim(), icon, color }) : api.createOpsCollection({ name: name.trim(), icon, color }),
  );
  const remove = useOpsMutation(() => api.deleteOpsCollection(collection!.id));
  return (
    <OpsModal
      title={collection ? "Edit collection" : "New collection"}
      onClose={onClose}
      onSubmit={() =>
        name.trim() &&
        save.mutate(undefined, {
          onSuccess: (c) => { onToast(collection ? "Collection saved" : "Collection added"); onSaved?.(c); onClose(); },
          onError: (e) => onToast(errMessage(e, "Couldn't save the collection")),
        })
      }
      foot={
        <div className="setform__footactions">
          {collection && (
            <button
              type="button"
              className="btn-ghost danger ops-foot-left"
              onClick={() => {
                if (!window.confirm(`Delete “${collection.name}”? Its SOPs stay, just outside any collection.`)) return;
                remove.mutate(undefined, {
                  onSuccess: () => { onToast("Collection deleted"); onDeleted?.(collection.id); onClose(); },
                  onError: (e) => onToast(errMessage(e, "Couldn't delete it")),
                });
              }}
            >
              Delete
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!name.trim() || save.isPending}>{collection ? "Save" : "Add collection"}</button>
        </div>
      }
    >
      <div className="ops-colform__preview">
        <OpsTile icon={icon} color={color} size={52} />
        <label className="field ops-grow">
          <span>Name</span>
          <input value={name} autoFocus maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Daily operations" required />
        </label>
      </div>
      <IconPicker value={icon} onChange={setIcon} />
      <ColorPicker value={color} onChange={setColor} />
    </OpsModal>
  );
}

export function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <span>Icon</span>
      <div className="ops-icons" role="radiogroup" aria-label="Icon">
        {OPS_ICONS.map((e) => (
          <button key={e} type="button" role="radio" aria-checked={value === e} className={"ops-icons__b" + (value === e ? " on" : "")} onClick={() => onChange(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <span>Colour</span>
      <div className="ops-colors" role="radiogroup" aria-label="Colour">
        {OPS_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            aria-label={c}
            className={"ops-colors__b" + (value === c ? " on" : "")}
            style={{ background: c }}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
    </div>
  );
}

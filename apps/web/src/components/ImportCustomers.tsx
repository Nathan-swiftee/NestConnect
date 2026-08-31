import { useMemo, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import type { ImportContactsResult } from "@ding/schemas";
import { useImportContacts } from "../hooks";
import { parseCsvTable, type CsvTable } from "../lib/csv";
import {
  matchColumns,
  rowsToContacts,
  splitTags,
  type ColumnMap,
  type ImportField,
} from "../lib/import-mapping";
import { AlertIcon, CheckIcon, DocIcon, XIcon } from "../lib/icons";

/**
 * Bringing a customer list in from a spreadsheet.
 *
 * The shape of this screen follows from one observation: the step people
 * abandon is the column mapping. Asked to pair six of our field names against
 * six of theirs before anything happens, most people close the tab. So the
 * mapping is *guessed* — see `matchColumns` — and shown as something already
 * done that can be corrected, rather than as a form to fill in.
 *
 * It shows real rows from the file under each guess. A mapping that says
 * "Phone → column 3" is a claim you cannot check; the first three values in
 * column 3 are one you can, at a glance, which is what turns a nervous import
 * into an obvious one.
 *
 * Nothing is sent until Import. The file is read in the browser, so a wrong
 * file costs a click rather than a directory full of rubbish to clean up.
 */
export function ImportCustomers({
  existingTags,
  onClose,
  onToast,
}: {
  /** Every tag already in use, offered as suggestions for the bulk tag field. */
  existingTags: string[];
  onClose: () => void;
  onToast: (msg: string) => void;
}): JSX.Element {
  const runImport = useImportContacts();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [tagText, setTagText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportContactsResult | null>(null);

  const bulkTags = useMemo(() => splitTags(tagText), [tagText]);

  const parsed = useMemo(
    () => (table ? rowsToContacts(table.rows, map, bulkTags) : []),
    [table, map, bulkTags],
  );
  const ready = parsed.filter((r) => r.contact);
  const skipped = parsed.filter((r) => !r.contact);

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    try {
      const text = await file.text();
      const t = parseCsvTable(text);
      if (t.headers.length === 0) {
        setError("That file looks empty.");
        return;
      }
      if (t.rows.length === 0) {
        setError("That file has a header row but no customers under it.");
        return;
      }
      setFileName(file.name);
      setTable(t);
      setMap(matchColumns(t.headers));
    } catch {
      setError("That file couldn’t be read. A .csv exported from your spreadsheet works best.");
    }
  }

  function setField(field: ImportField, index: number | undefined) {
    setMap((m) => {
      const next: ColumnMap = { ...m };
      if (index === undefined) delete next[field];
      else {
        // A column can only feed one field. Taking it from wherever it was
        // keeps the preview honest about what will actually be imported.
        for (const k of Object.keys(next) as ImportField[]) {
          if (next[k] === index) delete next[k];
        }
        next[field] = index;
      }
      return next;
    });
  }

  function submit() {
    if (!ready.length || runImport.isPending) return;
    runImport.mutate(
      { contacts: ready.map((r) => r.contact!), tags: bulkTags },
      {
        onSuccess: (res) => {
          setResult(res);
          const n = res.created + res.matched;
          onToast(`Imported ${n} customer${n === 1 ? "" : "s"}`);
        },
        onError: (e: unknown) =>
          setError(e instanceof Error && e.message ? e.message : "The import failed. Please try again."),
      },
    );
  }

  return createPortal(
    <div className="modal" onClick={onClose}>
      <div
        className="modal__box modal--form"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Import customers"
      >
        <div className="modal__head">
          <h2>Import customers</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        <div className="modal__body">
          {result ? (
            <ImportSummary result={result} />
          ) : !table ? (
            <DropZone
              inputRef={fileRef}
              onFile={onFile}
              onPick={() => fileRef.current?.click()}
            />
          ) : (
            <>
              <div className="imp__file">
                <DocIcon />
                <span className="imp__filename">{fileName}</span>
                <span className="imp__count">
                  {table.rows.length} row{table.rows.length === 1 ? "" : "s"}
                </span>
                <button type="button" className="btn-ghost" onClick={() => setTable(null)}>
                  Choose another
                </button>
              </div>

              <p className="fieldhint">
                We’ve matched your column headings to our fields — check them below and change any that are
                wrong. Only <b>Name</b> plus a phone or email are needed; anything left as <i>Don’t import</i>{" "}
                is ignored.
              </p>

              <div className="impmap">
                {(
                  [
                    ["displayName", "Name"],
                    ["firstName", "First name"],
                    ["lastName", "Last name"],
                    ["company", "Company"],
                    ["phone", "Phone"],
                    ["email", "Email"],
                    ["tags", "Tags"],
                  ] as [ImportField, string][]
                ).map(([field, label]) => (
                  <FieldRow
                    key={field}
                    label={label}
                    headers={table.headers}
                    rows={table.rows}
                    value={map[field]}
                    onChange={(i) => setField(field, i)}
                  />
                ))}
              </div>

              <label className="field">
                <span>Tag everyone in this import</span>
                <input
                  value={tagText}
                  onChange={(e) => setTagText(e.target.value)}
                  placeholder="e.g. trade-show, wholesale"
                  list="import-tag-suggestions"
                />
                <datalist id="import-tag-suggestions">
                  {existingTags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
              <p className="fieldhint">
                Added to every customer in the file, separated by commas. Customers already on file are tagged
                too rather than duplicated — so re-importing the same list is safe.
              </p>

              {skipped.length > 0 && (
                <div className="impskip">
                  <AlertIcon />
                  <div>
                    <b>
                      {skipped.length} row{skipped.length === 1 ? "" : "s"} will be skipped
                    </b>
                    <small>
                      {[...new Set(skipped.map((s) => s.problem))].join(" · ")} — row
                      {skipped.length === 1 ? " " : "s "}
                      {skipped.slice(0, 8).map((s) => s.line).join(", ")}
                      {skipped.length > 8 ? "…" : ""}
                    </small>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="fielderror" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="modal__foot">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {result ? "Done" : "Cancel"}
          </button>
          {!result && (
            <button
              type="button"
              className="btn-primary"
              onClick={submit}
              disabled={!ready.length || runImport.isPending}
            >
              {runImport.isPending
                ? "Importing…"
                : ready.length
                  ? `Import ${ready.length} customer${ready.length === 1 ? "" : "s"}`
                  : "Import"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The file step: click or drop. */
function DropZone({
  inputRef,
  onFile,
  onPick,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  onFile: (f: File) => void;
  onPick: () => void;
}): JSX.Element {
  const [over, setOver] = useState(false);
  return (
    <>
      <div
        className={"impdrop" + (over ? " over" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        onClick={onPick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onPick();
        }}
      >
        <DocIcon />
        <b>Drop a CSV here, or choose a file</b>
        <small>Exported from Excel, Numbers, Google Sheets or your old CRM.</small>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            // Cleared so picking the same file twice still fires a change.
            e.target.value = "";
          }}
        />
      </div>
      <p className="fieldhint">
        The first row should be your column headings — we’ll work out which is which. Nothing is sent
        anywhere until you press Import.
      </p>
    </>
  );
}

/** One field, its chosen column, and the first values in it. */
function FieldRow({
  label,
  headers,
  rows,
  value,
  onChange,
}: {
  label: string;
  headers: string[];
  rows: string[][];
  value?: number;
  onChange: (index: number | undefined) => void;
}): JSX.Element {
  // Three real values, because a column name is a claim and its contents are
  // the evidence. Blank cells are skipped so a sparse column still shows what
  // it holds rather than three empty strings.
  const sample =
    value === undefined
      ? []
      : rows
          .map((r) => (r[value] ?? "").trim())
          .filter(Boolean)
          .slice(0, 3);

  return (
    <div className="impmap__row">
      <span className="impmap__label">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        aria-label={`Column for ${label}`}
      >
        <option value="">Don’t import</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </select>
      <span className="impmap__sample" title={sample.join(" · ")}>
        {sample.length ? sample.join(" · ") : "—"}
      </span>
    </div>
  );
}

/** What the import actually did. */
function ImportSummary({ result }: { result: ImportContactsResult }): JSX.Element {
  return (
    <div className="impdone">
      <div className="impdone__ic">
        <CheckIcon />
      </div>
      <h3>Import finished</h3>
      <ul className="impdone__stats">
        <li>
          <b>{result.created}</b> added
        </li>
        <li>
          <b>{result.matched}</b> already on file — tagged
        </li>
        {result.failed.length > 0 && (
          <li className="bad">
            <b>{result.failed.length}</b> couldn’t be imported
          </li>
        )}
      </ul>
      {result.failed.length > 0 && (
        <div className="impfails">
          {result.failed.slice(0, 10).map((f) => (
            <div key={f.index} className="impfails__row">
              <b>{f.name || `Row ${f.index + 1}`}</b>
              <small>{f.error}</small>
            </div>
          ))}
          {result.failed.length > 10 && <small>…and {result.failed.length - 10} more.</small>}
        </div>
      )}
    </div>
  );
}

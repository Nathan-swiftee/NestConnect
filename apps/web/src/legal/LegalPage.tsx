import { BRAND_ASSETS } from "@ding/design/logo";
import { OWNER_FIELDS, type PrivacyOwnerFields } from "../privacy/policy";
import { renderRuns } from "../privacy/PrivacyPage";
import { resolveDataDeletion, resolveTerms, type LegalResolution } from "./content";

/**
 * The public terms of service and data deletion pages. Like the privacy page:
 * no session, no API call, no shared client — rendered entirely from the
 * content module, so they work for anyone, signed in or not.
 *
 * Fail closed: until every owner field is resolved these render only a neutral
 * "being finalised" notice — never draft operator facts and never a placeholder.
 */
export function TermsPage({ fields = OWNER_FIELDS }: { fields?: PrivacyOwnerFields }) {
  return <LegalPage resolution={resolveTerms(fields)} pendingTitle="Terms of service" testId="terms" />;
}

export function DataDeletionPage({ fields = OWNER_FIELDS }: { fields?: PrivacyOwnerFields }) {
  return <LegalPage resolution={resolveDataDeletion(fields)} pendingTitle="Data deletion" testId="data-deletion" />;
}

function LegalPage({ resolution, pendingTitle, testId }: { resolution: LegalResolution; pendingTitle: string; testId: string }) {
  return (
    <div className="pp">
      <header className="pp__bar">
        <a className="pp__brand" href="/" aria-label="NestConnect home">
          <img className="pp__lockup" src={BRAND_ASSETS.lockup} alt="NestConnect" draggable={false} />
        </a>
      </header>

      <main className="pp__main">
        {resolution.status === "pending" ? (
          <section className="pp__pending" data-testid={`${testId}-pending`}>
            <h1 className="pp__title">{pendingTitle}</h1>
            <p className="pp__lede">This page is being finalised and will be published here shortly.</p>
          </section>
        ) : (
          <article className="pp__doc" data-testid={`${testId}-document`}>
            <h1 className="pp__title">{resolution.document.title}</h1>
            <p className="pp__meta">{resolution.document.meta}</p>
            {resolution.document.notice ? (
              <p className="pp__notice" role="note" data-testid={`${testId}-draft-notice`}>
                {resolution.document.notice}
              </p>
            ) : null}
            <p className="pp__lede">{renderRuns(resolution.document.intro)}</p>

            <nav className="pp__toc" aria-label="Contents">
              <ol>
                {resolution.document.sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`}>{s.title}</a>
                  </li>
                ))}
              </ol>
            </nav>

            {resolution.document.sections.map((s) => (
              <section key={s.id} id={s.id} className="pp__section">
                <h2>{s.title}</h2>
                {s.blocks.map((b, i) =>
                  b.kind === "p" ? (
                    <p key={i}>{renderRuns(b.runs)}</p>
                  ) : b.kind === "sub" ? (
                    <h3 key={i}>{b.title}</h3>
                  ) : (
                    <ul key={i}>
                      {b.items.map((item, j) => (
                        <li key={j}>{renderRuns(item)}</li>
                      ))}
                    </ul>
                  ),
                )}
              </section>
            ))}
          </article>
        )}
      </main>
    </div>
  );
}

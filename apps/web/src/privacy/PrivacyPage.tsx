import { BRAND_ASSETS } from "@ding/design/logo";
import { OWNER_FIELDS, resolvePolicy, type PrivacyOwnerFields, type Run } from "./policy";

/**
 * The public privacy page. No session, no API call, no shared client: it is
 * rendered entirely from the content module, so it works for anyone, signed in
 * or not, and can't be caught by the inbox's login gate.
 *
 * Fail closed: until every owner field is resolved this renders only a neutral
 * "being finalised" notice — never draft text and never a placeholder.
 */
export function PrivacyPage({ fields = OWNER_FIELDS }: { fields?: PrivacyOwnerFields }) {
  const policy = resolvePolicy(fields);

  return (
    <div className="pp">
      <header className="pp__bar">
        <a className="pp__brand" href="/" aria-label="Nest Connect home">
          <span className="pp__mark">
            <img src={BRAND_ASSETS.mark} alt="" aria-hidden="true" draggable={false} />
          </span>
          <span className="pp__wordmark">
            Nest <span className="pp__dot">Connect</span>
          </span>
        </a>
      </header>

      <main className="pp__main">
        {policy.status === "pending" ? (
          <section className="pp__pending" data-testid="privacy-pending">
            <h1 className="pp__title">Privacy policy</h1>
            <p className="pp__lede">Our privacy policy is being finalised and will be published here shortly.</p>
          </section>
        ) : (
          <article className="pp__doc" data-testid="privacy-policy">
            <h1 className="pp__title">{policy.document.title}</h1>
            <p className="pp__meta">Effective {policy.document.effectiveDate}</p>
            <p className="pp__lede">{renderRuns(policy.document.intro)}</p>

            <nav className="pp__toc" aria-label="Contents">
              <ol>
                {policy.document.sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`}>{s.title}</a>
                  </li>
                ))}
              </ol>
            </nav>

            {policy.document.sections.map((s) => (
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

function renderRuns(runs: Run[]) {
  return runs.map((r, i) =>
    typeof r === "string" ? (
      <span key={i}>{r}</span>
    ) : (
      <a key={i} href={r.href}>
        {r.text}
      </a>
    ),
  );
}

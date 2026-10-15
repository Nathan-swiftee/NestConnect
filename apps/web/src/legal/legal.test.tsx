import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DataDeletionPage, TermsPage } from "./LegalPage";
import { buildDataDeletion, buildTerms, legalText, resolveDataDeletion, resolveTerms, TERMS_DRAFT } from "./content";
import { isDataDeletionPath, isTermsPath } from "./route";
import {
  OWNER_FIELDS,
  OWNER_FIELD_NAMES,
  containsPlaceholderMarker,
  type PrivacyOwnerFields,
  type ResolvedOwnerFields,
} from "../privacy/policy";

/** Test fixture values only — deliberately not real owner facts. */
const FILLED: ResolvedOwnerFields = {
  controllerName: "Fixture Company Ltd",
  companyDetails: "registered in Fixtureland, number 00000000",
  postalAddress: "1 Fixture Street, Fixture Town, FX1 1XX",
  contactEmail: "legal@fixture-company.test",
  effectiveDate: "2026-01-15",
  endCustomerDataRole: "processor",
  hostingProvider: "Fixture Hosting",
  hostingRegion: "Fixtureland",
  internationalTransfersStatement: "Fixture statement about international transfers.",
  retentionStatement: "Fixture statement about retention periods.",
  backupStatement: "Fixture statement about backups.",
  legalBasesStatement: "Fixture statement about legal bases.",
  jurisdictionalRightsStatement: "Fixture statement about regional rights.",
  childrenStatement: "Fixture statement about children.",
  secretEncryptionEnabledInProduction: true,
  sentryEnabledInProduction: true,
  cloudflareInFrontOfDomain: true,
  r2StorageInProduction: true,
  whatsappCloudApiInUse: true,
  gmailIntegrationInUse: true,
  postmarkInUse: true,
  resendInUse: true,
  smtpInUse: true,
  anthropicPolishAvailable: true,
  sdkCustomerPushInUse: true,
};

const ALL_UNRESOLVED = Object.fromEntries(OWNER_FIELD_NAMES.map((k) => [k, null])) as unknown as PrivacyOwnerFields;

/** Visible text only, so attribute values and markup can't hide or fake a match. */
const visibleText = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const PAGES = [
  {
    name: "terms",
    Page: TermsPage,
    build: buildTerms,
    resolve: resolveTerms,
    isPath: isTermsPath,
    path: "/terms",
    html: "terms.html",
    main: "terms-main.tsx",
  },
  {
    name: "data-deletion",
    Page: DataDeletionPage,
    build: buildDataDeletion,
    resolve: resolveDataDeletion,
    isPath: isDataDeletionPath,
    path: "/data-deletion",
    html: "data-deletion.html",
    main: "data-deletion-main.tsx",
  },
] as const;

for (const page of PAGES) {
  const html = (fields?: PrivacyOwnerFields) => renderToStaticMarkup(<page.Page fields={fields} />);

  describe(`${page.name} — shipped owner fields`, () => {
    it("renders the full document with the real operator facts", () => {
      expect(page.resolve().status).toBe("ready");
      const out = html();
      expect(out).toContain(`data-testid="${page.name}-document"`);
      expect(out).not.toContain(`data-testid="${page.name}-pending"`);
      const text = visibleText(out);
      expect(containsPlaceholderMarker(text)).toBe(false);
      for (const fact of ["Nest Partners Limited", "14 Grosvenor Way, London, E5 9ND", "info@swiftee.co.uk"]) expect(text).toContain(fact);
      expect(out).toContain('href="mailto:info@swiftee.co.uk"');
    });
  });

  describe(`${page.name} — unresolved owner fields (fail closed)`, () => {
    it("shows only the neutral 'being finalised' state, with no draft body or field names", () => {
      const out = html(ALL_UNRESOLVED);
      expect(out).toContain(`data-testid="${page.name}-pending"`);
      expect(out).toContain("being finalised");
      expect(out).not.toContain(`data-testid="${page.name}-document"`);
      const text = visibleText(out);
      expect(containsPlaceholderMarker(text)).toBe(false);
      for (const name of OWNER_FIELD_NAMES) expect(text).not.toContain(name);
      for (const s of page.build(FILLED).sections) expect(text).not.toContain(s.title);
    });

    it("stays pending while even one field is missing", () => {
      for (const name of OWNER_FIELD_NAMES) {
        const partial = { ...FILLED, [name]: null } as PrivacyOwnerFields;
        expect(page.resolve(partial).status, name).toBe("pending");
      }
    });

    it("treats placeholder text as unresolved", () => {
      for (const c of [{ contactEmail: "privacy@example.com" }, { postalAddress: "TBD" }, { controllerName: "[OWNER: name]" }]) {
        expect(page.resolve({ ...FILLED, ...c } as PrivacyOwnerFields).status, JSON.stringify(c)).toBe("pending");
      }
    });
  });

  describe(`${page.name} — fixture values`, () => {
    it("renders every section and no placeholder markers", () => {
      const doc = page.build(FILLED);
      expect(containsPlaceholderMarker(legalText(doc))).toBe(false);
      const text = visibleText(html(FILLED));
      for (const s of doc.sections) expect(text).toContain(s.title);
      expect(text).toContain("Fixture Company Ltd");
      expect(text).not.toMatch(/\bnull\b|\bundefined\b|NaN|\[object Object\]/);
      for (const name of OWNER_FIELD_NAMES) expect(text).not.toContain(name);
    });
  });

  describe(`${page.name} — public route`, () => {
    beforeEach(() => {
      // Any network call would mean the page depends on a session/API. It must not.
      vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network not allowed"))));
    });
    afterEach(() => vi.unstubAllGlobals());

    it(`matches ${page.path} (and its variants) and nothing else`, () => {
      for (const p of [page.path, `${page.path}/`, page.path.toUpperCase(), `${page.path}.html`]) expect(page.isPath(p), p).toBe(true);
      for (const p of ["/", "/privacy", `${page.path}-old`, `/settings${page.path}`, `${page.path}x`, `/api${page.path}`]) {
        expect(page.isPath(p), p).toBe(false);
      }
    });

    it("renders without a signed-in session, a query client or any network call", () => {
      for (const fields of [undefined, FILLED, ALL_UNRESOLVED]) {
        const out = html(fields);
        expect(out).not.toContain('type="password"');
        expect(out).not.toContain("<form");
      }
      expect(fetch).not.toHaveBeenCalled();
    });

    const webRoot = resolve(__dirname, "..", "..");

    it("has its own document and Vite entry, separate from the inbox", () => {
      const doc = readFileSync(join(webRoot, page.html), "utf8");
      expect(doc).toContain(`src="/src/legal/${page.main}"`);
      expect(doc).toContain(`id="${page.name}"`);
      const vite = readFileSync(join(webRoot, "vite.config.ts"), "utf8");
      expect(vite).toMatch(new RegExp(`"?${page.name}"?:\\s*resolve\\(__dirname,\\s*"${page.html.replace(".", "\\.")}"\\)`));
    });

    it("is routed by the inbox entry before the session gate", () => {
      const main = readFileSync(join(webRoot, "src", "main.tsx"), "utf8");
      const fn = page.name === "terms" ? "isTermsPath" : "isDataDeletionPath";
      const branch = main.indexOf(`${fn}(window.location.pathname)`);
      const app = main.indexOf("<App />");
      expect(branch).toBeGreaterThan(-1);
      expect(app).toBeGreaterThan(branch);
    });
  });
}

describe("terms — draft for legal review", () => {
  it("says on the page that it is a draft pending legal review, while TERMS_DRAFT is set", () => {
    const out = renderToStaticMarkup(<TermsPage />);
    if (TERMS_DRAFT) {
      expect(out).toContain('data-testid="terms-draft-notice"');
      expect(visibleText(out)).toContain("Draft for legal review");
    } else {
      expect(out).not.toContain('data-testid="terms-draft-notice"');
    }
  });

  it("is governed by English law and links to the privacy and data deletion pages", () => {
    const text = legalText(buildTerms(FILLED));
    expect(text).toContain("England and Wales");
    expect(text).toContain("/privacy");
    expect(text).toContain("/data-deletion");
  });

  it("only mentions the channels the owner confirmed", () => {
    const off = legalText(buildTerms({ ...FILLED, whatsappCloudApiInUse: false, gmailIntegrationInUse: false, anthropicPolishAvailable: false }));
    for (const absent of ["WhatsApp", "Gmail", "AI features"]) expect(off, absent).not.toContain(absent);
    const on = legalText(buildTerms(FILLED));
    for (const present of ["WhatsApp Business Messaging Policy", "Gmail", "AI features"]) expect(on, present).toContain(present);
  });
});

describe("data deletion — instructions", () => {
  it("tells businesses and their customers how to ask, and commits to 90 days", () => {
    const text = visibleText(renderToStaticMarkup(<DataDeletionPage />));
    expect(text).toContain("If your business uses NestConnect");
    expect(text).toContain("If you have messaged a business that uses NestConnect");
    expect(text).toContain("within 90 days");
    // Same 90-day promise as the privacy policy.
    expect(OWNER_FIELDS.retentionStatement).toContain("within 90 days");
  });

  it("explains removing a Facebook-connected WhatsApp integration only when WhatsApp is offered", () => {
    expect(legalText(buildDataDeletion(FILLED))).toContain("Business integrations");
    expect(legalText(buildDataDeletion({ ...FILLED, whatsappCloudApiInUse: false }))).not.toContain("Business integrations");
  });
});

describe("legal pages — isolation", () => {
  it("never import the inbox, its login gate or the API client", () => {
    const dir = resolve(__dirname);
    for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))) {
      const src = readFileSync(join(dir, file), "utf8");
      expect(src, file).not.toMatch(/from\s+["'](\.\.\/App|\.\.\/hooks|\.\.\/components\/|@ding\/client|@tanstack\/react-query)/);
    }
  });
});

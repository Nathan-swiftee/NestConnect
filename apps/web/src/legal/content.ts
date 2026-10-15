/**
 * The NestConnect terms of service and data deletion instructions.
 *
 * Operator facts (who we are, where to write, which channels production
 * offers) come from the privacy policy's owner fields, so the three public
 * pages can never disagree about them. Same fail-closed rule as the policy:
 * until every owner field is resolved and the built text carries no
 * placeholder marker, a page answers `pending` and renders only a neutral
 * notice.
 *
 * The terms are a working draft that has not been through legal review, and
 * say so on the page (TERMS_DRAFT). Once a lawyer has approved the text, set
 * TERMS_DRAFT to false and TERMS_LAST_UPDATED to the approval date.
 */
import {
  OWNER_FIELDS,
  containsPlaceholderMarker,
  formatEffectiveDate,
  unresolvedOwnerFields,
  type Block,
  type PolicySection,
  type PrivacyOwnerFields,
  type ResolvedOwnerFields,
  type Run,
} from "../privacy/policy";

/** The terms below are a draft pending legal review; the page shows a notice while this is true. */
export const TERMS_DRAFT = true;
export const TERMS_LAST_UPDATED = "2026-10-15";
export const DATA_DELETION_LAST_UPDATED = "2026-10-15";

export const TERMS_DRAFT_NOTICE =
  "Draft for legal review. These terms are a working draft and have not yet been reviewed by our lawyers. They may change before they are finalised; we will update this page when they are.";

export interface LegalDocument {
  title: string;
  /** "Last updated 15 October 2026". */
  meta: string;
  /** Shown above the document when set (the draft notice). */
  notice?: string;
  intro: Run[];
  sections: PolicySection[];
}

export type LegalResolution = { status: "ready"; document: LegalDocument } | { status: "pending" };

const p = (...runs: Run[]): Block => ({ kind: "p", runs });
const list = (...items: (string | Run[])[]): Block => ({
  kind: "list",
  items: items.map((i) => (typeof i === "string" ? [i] : i)),
});
const sub = (title: string): Block => ({ kind: "sub", title });
const mail = (address: string): Run => ({ text: address, href: `mailto:${address}` });
const link = (text: string, href: string): Run => ({ text, href });

/** Every human-readable string in a document, for checks and tests. */
export function legalText(doc: LegalDocument): string {
  const runs = (rs: Run[]) => rs.map((r) => (typeof r === "string" ? r : `${r.text} ${r.href}`)).join("");
  const out: string[] = [doc.title, doc.meta, doc.notice ?? "", runs(doc.intro)];
  for (const s of doc.sections) {
    out.push(s.title);
    for (const b of s.blocks) {
      if (b.kind === "p") out.push(runs(b.runs));
      else if (b.kind === "list") out.push(...b.items.map(runs));
      else out.push(b.title);
    }
  }
  return out.join("\n");
}

/* ------------------------------------------------------------------------ */
/* Terms of service                                                          */
/* ------------------------------------------------------------------------ */

export function buildTerms(f: ResolvedOwnerFields): LegalDocument {
  const channels = [
    ...(f.whatsappCloudApiInUse ? ["WhatsApp (through Meta's WhatsApp Business Platform)"] : []),
    ...(f.gmailIntegrationInUse ? ["Gmail and other email"] : ["email"]),
    "the NestChat chat widget on your website",
    ...(f.sdkCustomerPushInUse ? ["chat inside your own mobile app (our in-app SDK)"] : []),
  ];

  const sections: PolicySection[] = [];

  sections.push({
    id: "about",
    title: "About these terms",
    blocks: [
      p(
        `These terms are an agreement between ${f.controllerName} (${f.companyDetails}), ${f.postalAddress} ("we", "us", "our") and the business or organisation that signs up for NestConnect ("you", "your"). They apply to the NestConnect web app at nestconnect.io, the NestConnect mobile apps, the NestChat widget and our in-app SDK (together, the "Service").`,
      ),
      p(
        "By creating a workspace, or by using the Service, you accept these terms. If you accept them on behalf of a business, you confirm that you have authority to bind it. The Service is for business use only and is not offered to consumers.",
      ),
      p(
        "If we have signed a separate order form or agreement with you, that document takes priority over these terms where they conflict.",
      ),
    ],
  });

  sections.push({
    id: "service",
    title: "The Service",
    blocks: [
      p(
        `NestConnect is a shared team inbox. It lets your team receive, answer, assign and organise conversations with your customers from one place, over ${channels.join(", ")}.`,
      ),
      p(
        "We may improve, change or remove features from time to time. If we remove a feature you rely on in a way that materially reduces the Service, we will give you reasonable notice where we can.",
      ),
    ],
  });

  sections.push({
    id: "accounts",
    title: "Accounts and security",
    blocks: [
      list(
        "You must give accurate information when you create your workspace and keep it up to date.",
        "Each person who uses the Service on your behalf (a \"workspace user\") must have their own account, be at least 18 years old, and use it for work.",
        "You are responsible for your workspace users, for what they do in the Service, and for keeping their sign-in details and two-step verification secure.",
        ["Tell us straight away at ", mail(f.contactEmail), " if you believe an account has been used without permission."],
      ),
    ],
  });

  const channelTerms: Block[] = [
    p(
      "The Service connects to messaging and email services run by other companies. Your use of each channel is also subject to that provider's own terms and policies, and you are responsible for complying with them.",
    ),
  ];
  if (f.whatsappCloudApiInUse) {
    channelTerms.push(
      sub("WhatsApp"),
      list(
        "You must comply with the WhatsApp Business Terms of Service, the WhatsApp Business Messaging Policy and the WhatsApp Commerce Policy, and any other Meta terms that apply to your WhatsApp Business Account.",
        "You must have your customers' permission (opt-in) before you message them on WhatsApp, and you must honour requests to stop.",
        "Meta may charge for messages sent through the WhatsApp Business Platform. Unless we agree otherwise in writing, those charges are billed by Meta to your WhatsApp Business Account and are your responsibility.",
        "Meta can restrict, suspend or disconnect a WhatsApp number or account. We are not responsible for Meta's decisions, but we will help you where we reasonably can.",
      ),
    );
  }
  if (f.gmailIntegrationInUse) {
    channelTerms.push(
      sub("Gmail"),
      p(
        "When you connect a Gmail mailbox, you authorise NestConnect to send and read email for that mailbox through Google's APIs. You can disconnect a mailbox at any time in NestConnect or in your Google account settings. Your use of Gmail remains subject to Google's terms.",
      ),
    );
  }
  channelTerms.push(
    p(
      "We do not control third-party services and are not responsible for their availability, changes or outages, or for messages they fail to deliver.",
    ),
  );
  sections.push({ id: "channels", title: "Third-party channels", blocks: channelTerms });

  sections.push({
    id: "acceptable-use",
    title: "Acceptable use",
    blocks: [
      p("You must not, and must not let anyone else, use the Service to:"),
      list(
        "send spam, bulk unsolicited messages, or messages to people who have not agreed to hear from you or who have asked you to stop;",
        "send anything unlawful, fraudulent, defamatory, harassing, hateful or obscene, or that infringes anyone's rights;",
        "send malware, or try to break into, overload or disrupt the Service or any connected service;",
        "get around usage limits, security measures or access controls, or access another workspace's data;",
        "copy, resell or sublicense the Service, or reverse engineer it except where the law allows; or",
        "break any law, including data protection, privacy, marketing and consumer protection law.",
      ),
      p(
        "We may remove content or suspend access where we reasonably believe these rules have been broken (see \"Suspension and termination\").",
      ),
    ],
  });

  sections.push({
    id: "your-data",
    title: "Your data",
    blocks: [
      p(
        "You own the messages, contacts, files and other content that you and your customers put into the Service (\"Your Data\"). You give us permission to host, process, transmit and display Your Data only as needed to provide, secure and support the Service for you.",
      ),
      p(
        f.endCustomerDataRole === "processor"
          ? "For personal data about your customers, you are the controller and we act as your processor. We process that data only on your documented instructions (which these terms and your use of the Service represent), keep it confidential and secure, use the sub-processors listed in our "
          : "How we handle personal data is described in our ",
        link("Privacy Policy", "/privacy"),
        f.endCustomerDataRole === "processor"
          ? ", help you respond to your customers' requests, and delete it when the Service ends as described below. We will enter into a data processing agreement with you on request."
          : ".",
      ),
      p(
        "You are responsible for having a lawful basis to collect and use your customers' personal data in the Service, for giving them any notices the law requires, and for the accuracy and lawfulness of Your Data.",
      ),
      p(
        "You can export or delete Your Data as described on our ",
        link("Data deletion", "/data-deletion"),
        " page.",
      ),
    ],
  });

  if (f.anthropicPolishAvailable) {
    sections.push({
      id: "ai",
      title: "AI features",
      blocks: [
        p(
          "Some optional features use AI (for example, rewriting a draft reply or writing a short subject for a new conversation). AI output can be inaccurate or inappropriate. You are responsible for reviewing anything AI suggests before you send it, and for turning these features off in Settings if you do not want them. Our Privacy Policy explains what is sent to our AI provider.",
        ),
      ],
    });
  }

  sections.push({
    id: "fees",
    title: "Fees and payment",
    blocks: [
      list(
        "Fees for the Service are those shown in your order form or otherwise agreed with us in writing. If we offer a free trial or free plan, we may end or change it at any time.",
        "Unless agreed otherwise, fees are billed in advance, are non-refundable, and are payable within 14 days of invoice. Fees exclude VAT and other taxes, which you will pay in addition where they apply.",
        "If an undisputed invoice is overdue, we may charge interest under the Late Payment of Commercial Debts (Interest) Act 1998 and, after giving you notice, suspend the Service until it is paid.",
        "We may change our fees by giving you at least 30 days' notice. The change applies from your next billing period.",
      ),
    ],
  });

  sections.push({
    id: "ip",
    title: "Intellectual property",
    blocks: [
      p(
        "We and our licensors own the Service, including its software, design and documentation, and all intellectual property in it. These terms give you a non-exclusive, non-transferable right to use the Service for your business while they are in force. If you send us feedback or suggestions, we may use them without any obligation to you.",
      ),
    ],
  });

  sections.push({
    id: "confidentiality",
    title: "Confidentiality",
    blocks: [
      p(
        "Each of us will keep the other's confidential information confidential, and use it only to perform or receive the Service, except where it becomes public without breaching these terms, was already known, or must be disclosed by law.",
      ),
    ],
  });

  sections.push({
    id: "availability",
    title: "Availability and support",
    blocks: [
      p(
        "We use reasonable efforts to keep the Service available and secure, but it is provided without any guaranteed uptime unless we have agreed a service level with you in writing. We may need to interrupt the Service for maintenance, upgrades or emergencies, and will try to keep this to a minimum.",
      ),
      p("For support, contact us at ", mail(f.contactEmail), "."),
    ],
  });

  sections.push({
    id: "termination",
    title: "Suspension and termination",
    blocks: [
      list(
        "You can stop using the Service and close your workspace at any time by contacting us. Fees already paid are not refunded unless we agree otherwise.",
        "We can end these terms by giving you at least 30 days' notice.",
        "Either of us can end these terms immediately by notice if the other materially breaches them and does not fix the breach within 14 days of being asked to, or becomes insolvent.",
        "We can suspend all or part of the Service immediately if we reasonably need to: to protect the Service, other customers or the public; because of a breach of the acceptable use rules; or because a law, court or channel provider requires it. We will tell you why, and restore access once the issue is resolved.",
      ),
      p(
        "When these terms end, your access to the Service ends. You can ask us for an export of Your Data before then. We delete Your Data within 90 days of your workspace closing, unless the law requires us to keep some of it for longer. Sections that by their nature should survive (including fees owed, intellectual property, confidentiality, liability and governing law) continue after termination.",
      ),
    ],
  });

  sections.push({
    id: "warranties",
    title: "Warranties and disclaimers",
    blocks: [
      p(
        "We will provide the Service with reasonable skill and care. Apart from that, and to the extent the law allows, the Service is provided \"as is\" and we give no other warranties, conditions or representations, whether express or implied, including about fitness for a particular purpose or that the Service will be uninterrupted or error-free.",
      ),
    ],
  });

  sections.push({
    id: "liability",
    title: "Limitation of liability",
    blocks: [
      list(
        "Nothing in these terms limits or excludes liability for death or personal injury caused by negligence, for fraud or fraudulent misrepresentation, or for anything else that cannot be limited or excluded by law.",
        "Subject to that, neither of us is liable to the other for any loss of profits, revenue, business, goodwill or anticipated savings, or for any indirect or consequential loss, however it arises.",
        "Subject to that, each party's total liability arising out of or in connection with these terms in any 12-month period is limited to the fees you paid us for the Service in the 12 months before the event giving rise to the claim. This cap does not apply to your obligation to pay fees or to your indemnity below.",
      ),
    ],
  });

  sections.push({
    id: "indemnity",
    title: "Indemnity",
    blocks: [
      p(
        "You will indemnify us against claims, losses and reasonable costs arising from Your Data, from messages you or your workspace users send through the Service, or from your breach of the acceptable use rules or of a channel provider's terms.",
      ),
    ],
  });

  sections.push({
    id: "changes",
    title: "Changes to these terms",
    blocks: [
      p(
        "We may update these terms. If a change is material, we will give you at least 30 days' notice by email or in the Service before it takes effect. If you do not agree to the change, you can close your workspace before it takes effect. The date at the top of this page shows when the terms last changed.",
      ),
    ],
  });

  sections.push({
    id: "general",
    title: "General",
    blocks: [
      list(
        "You may not transfer your rights under these terms without our written consent. We may transfer ours to a company that takes over all or part of our business.",
        "Neither of us is liable for delays or failures caused by events outside our reasonable control.",
        "These terms (with any order form and our Privacy Policy) are the entire agreement between us about the Service and replace any earlier discussions.",
        "If any part of these terms is found to be unenforceable, the rest stays in force. A failure or delay in enforcing a right is not a waiver of it.",
        "No one other than you and us has any right to enforce these terms under the Contracts (Rights of Third Parties) Act 1999.",
      ),
    ],
  });

  sections.push({
    id: "law",
    title: "Governing law",
    blocks: [
      p(
        "These terms, and any dispute or claim arising out of or in connection with them, are governed by the law of England and Wales. The courts of England and Wales have exclusive jurisdiction.",
      ),
    ],
  });

  sections.push({
    id: "contact",
    title: "Contact",
    blocks: [p(`${f.controllerName}, ${f.postalAddress}. Email: `, mail(f.contactEmail), ".")],
  });

  return {
    title: "Terms of Service",
    meta: `Last updated ${formatEffectiveDate(TERMS_LAST_UPDATED)}`,
    notice: TERMS_DRAFT ? TERMS_DRAFT_NOTICE : undefined,
    intro: ["These terms set out the rules for using NestConnect. Please read them carefully."],
    sections,
  };
}

/* ------------------------------------------------------------------------ */
/* Data deletion                                                             */
/* ------------------------------------------------------------------------ */

export function buildDataDeletion(f: ResolvedOwnerFields): LegalDocument {
  const processor = f.endCustomerDataRole === "processor";
  const sections: PolicySection[] = [];

  sections.push({
    id: "business",
    title: "If your business uses NestConnect",
    blocks: [
      sub("Deleting your whole workspace"),
      p(
        "To close your workspace and have all of its data deleted, email ",
        mail(f.contactEmail),
        " from the email address of one of your workspace's admins. Include your workspace or business name and say that you want the workspace and its data deleted. If you would like an export of your data first, say so in the same email.",
      ),
      p(
        "We will confirm that we have received your request, may ask you to verify that you are authorised to make it, and will then delete the workspace and all of its data within 90 days, as stated in our ",
        link("Privacy Policy", "/privacy"),
        ". We will email you when the deletion is complete.",
      ),
      sub("Deleting individual records yourself"),
      p("Admins and managers can delete data straight away in the app:"),
      list(
        "Deleting a customer record permanently deletes that customer's one-to-one conversations, messages, internal notes, labels, assignment history, identifiers and registered push devices.",
        "Deleting a channel deletes the conversations and messages that belong to it.",
        "Removing a workspace user deletes their account, sessions, devices and notifications.",
      ),
      p(
        "Deleting a record in the app does not yet remove its attachment files from file storage or the custom field values recorded against it. Email us and we will remove those too.",
      ),
      ...(f.whatsappCloudApiInUse
        ? [
            sub("If you connected WhatsApp through Facebook"),
            p(
              "If you connected a WhatsApp Business Account to NestConnect using Facebook (Meta) sign-in, you can remove NestConnect's access at any time in Meta Business Suite, under Business settings, Integrations, Connected apps, or in your Facebook account under Settings and privacy, Settings, Business integrations. This stops NestConnect from receiving new data from Meta. It does not delete data NestConnect already holds; to have that deleted, email us as described above.",
            ),
          ]
        : []),
    ],
  });

  sections.push({
    id: "customer",
    title: "If you have messaged a business that uses NestConnect",
    blocks: [
      p(
        "If you have contacted a business, or it has contacted you, on WhatsApp, by email, or through the chat on its website or app, and that business uses NestConnect, your messages and contact details are held in NestConnect on that business's behalf.",
      ),
      p(
        processor
          ? "The business decides what happens to that data, so the quickest way to have it deleted is to ask the business directly. It can delete your record in NestConnect immediately."
          : "You can ask the business directly, and it can delete your record in NestConnect immediately.",
      ),
      p(
        "You can also email us at ",
        mail(f.contactEmail),
        ". Tell us which business you were in contact with and the phone number, email address or WhatsApp number you used, so that we can find your data. We may need to confirm your identity. ",
        processor
          ? "We will pass your request to the business and help it delete your data; if the business no longer uses NestConnect, we will delete it ourselves."
          : "We will delete your data, or tell you why we cannot.",
      ),
      p(
        "To clear what the website chat stores in your browser, clear the site data for that chat in your browser's settings.",
      ),
    ],
  });

  sections.push({
    id: "what-is-deleted",
    title: "What we delete, and what we may keep",
    blocks: [
      p(
        "When we delete a workspace, we delete its accounts, conversations, messages, attachments, contacts, custom fields, settings and the access tokens for connected channels such as WhatsApp and Gmail.",
      ),
      p(
        "We may keep a limited amount of information for longer where the law requires it (for example, invoicing records) or where we need it to resolve a dispute or enforce our agreements. We keep it only for as long as that reason applies.",
      ),
      p(f.backupStatement),
    ],
  });

  sections.push({
    id: "contact",
    title: "Contact",
    blocks: [
      p(`${f.controllerName}, ${f.postalAddress}. Email: `, mail(f.contactEmail), "."),
      p(
        "Our ",
        link("Privacy Policy", "/privacy"),
        " explains what information NestConnect collects and your other rights. Our ",
        link("Terms of Service", "/terms"),
        " cover how businesses may use NestConnect.",
      ),
    ],
  });

  return {
    title: "Data deletion",
    meta: `Last updated ${formatEffectiveDate(DATA_DELETION_LAST_UPDATED)}`,
    intro: [
      `How to ask ${f.controllerName}, which operates NestConnect, to delete your data, whether you are a business using NestConnect or someone who has messaged one.`,
    ],
    sections,
  };
}

/* ------------------------------------------------------------------------ */
/* Resolution                                                                */
/* ------------------------------------------------------------------------ */

function resolve(build: (f: ResolvedOwnerFields) => LegalDocument, fields: PrivacyOwnerFields): LegalResolution {
  if (unresolvedOwnerFields(fields).length) return { status: "pending" };
  const document = build(fields as ResolvedOwnerFields);
  if (containsPlaceholderMarker(legalText(document))) return { status: "pending" };
  return { status: "ready", document };
}

export function resolveTerms(fields: PrivacyOwnerFields = OWNER_FIELDS): LegalResolution {
  return resolve(buildTerms, fields);
}

export function resolveDataDeletion(fields: PrivacyOwnerFields = OWNER_FIELDS): LegalResolution {
  return resolve(buildDataDeletion, fields);
}

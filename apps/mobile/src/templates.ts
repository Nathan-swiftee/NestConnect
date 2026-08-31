import type { TemplateApproval } from "@ding/schemas";

/**
 * Reading a WhatsApp template body.
 *
 * Its own module rather than sitting in `TemplateSheet.tsx` for the usual
 * reason in this app: a component file reaches the theme, which reaches
 * AsyncStorage, which needs a native module — so anything importing it can only
 * run inside the app. This is arithmetic on a string, and it is the arithmetic
 * that decides what a customer actually receives, so it should be testable
 * without a device. Same split as `email-fit.ts`.
 */

/** Human label for a template's Meta approval state. */
export function approvalLabel(status: TemplateApproval): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "pending":
      return "Pending";
    case "rejected":
      return "Rejected";
    case "paused":
      return "Paused";
    case "disabled":
      return "Disabled";
    case "draft":
      return "Draft";
  }
}

/** One piece of a template body: literal text, or a `{{n}}` slot awaiting a value. */
export interface BodySegment {
  text: string;
  /** 1-based variable index, or null for literal text. */
  slot: number | null;
}

/**
 * Split a body into literal runs and `{{n}}` slots.
 *
 * Returned as data rather than as elements so the caller decides how a filled
 * slot and an empty one each look, and so this is testable without a renderer.
 *
 * The capturing split is what makes adjacent slots (`{{1}}{{2}}`) and slots at
 * either end work — `String.split` with a capture group keeps the delimiters,
 * and the empty runs it leaves between them are dropped rather than rendered.
 */
export function renderPreview(body: string): BodySegment[] {
  return body
    .split(/(\{\{\d+\}\})/g)
    .filter((seg) => seg.length > 0)
    .map((seg) => {
      const m = seg.match(/^\{\{(\d+)\}\}$/);
      return { text: seg, slot: m ? Number(m[1]) : null };
    });
}

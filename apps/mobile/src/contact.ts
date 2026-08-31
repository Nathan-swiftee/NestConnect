import type { Contact, UpdateContactInput } from "@ding/schemas";

/**
 * What actually changed on a customer's details — and nothing else.
 *
 * Sending the whole record back on every Save would overwrite any field
 * somebody else edited between the form opening and the button being pressed;
 * on a phone that gap is however long the screen was in a pocket. It also keeps
 * an untouched empty field out of the patch rather than writing it as `""`,
 * which the server would take as "clear this".
 *
 * Absent and empty stay distinguishable on purpose: clearing a field you *did*
 * touch does send `""`, because deleting a wrong phone number is a real edit
 * and the obvious `if (value)` guard would swallow it.
 *
 * A plain module, not a method on the component, so it can be tested without a
 * renderer — importing anything under `components/` pulls in the theme, which
 * pulls in AsyncStorage, which needs a device.
 */
export function contactPatch(
  contact: Partial<Pick<Contact, "displayName" | "company" | "phone" | "email">>,
  draft: { displayName: string; company: string; phone: string; email: string },
): UpdateContactInput {
  const patch: UpdateContactInput = {};
  const name = draft.displayName.trim();
  if (name && name !== contact.displayName) patch.displayName = name;
  if (draft.company.trim() !== (contact.company ?? "")) patch.company = draft.company.trim();
  if (draft.phone.trim() !== (contact.phone ?? "")) patch.phone = draft.phone.trim();
  if (draft.email.trim() !== (contact.email ?? "")) patch.email = draft.email.trim();
  return patch;
}

import { renderPreview } from "../src/templates";

/**
 * Splitting a template body into its literal runs and its `{{n}}` slots.
 *
 * The preview is the only thing standing between an agent and sending
 * "Hi {{1}}, your order {{2}} is ready" to a customer verbatim, so the split has
 * to find every slot — including the ones that make a naive regex miss:
 * adjacent slots with no text between them, a slot at either end, and
 * double-digit indices once a template has ten variables.
 */
describe("renderPreview", () => {
  const slots = (body: string) =>
    renderPreview(body)
      .filter((s) => s.slot != null)
      .map((s) => s.slot);

  it("splits literals from slots and keeps them in order", () => {
    expect(renderPreview("Hi {{1}}, your order is ready.")).toEqual([
      { text: "Hi ", slot: null },
      { text: "{{1}}", slot: 1 },
      { text: ", your order is ready.", slot: null },
    ]);
  });

  it("finds adjacent slots with nothing between them", () => {
    expect(slots("{{1}}{{2}}")).toEqual([1, 2]);
  });

  it("finds slots at the very start and very end", () => {
    expect(slots("{{1}} is due {{2}}")).toEqual([1, 2]);
  });

  it("reads double-digit indices as one number, not as {{1}} then 0", () => {
    expect(slots("{{10}}")).toEqual([10]);
  });

  it("emits no empty runs", () => {
    expect(renderPreview("{{1}}{{2}}").every((s) => s.text.length > 0)).toBe(true);
  });

  it("leaves a body with no variables as a single literal", () => {
    expect(renderPreview("Your table is confirmed.")).toEqual([
      { text: "Your table is confirmed.", slot: null },
    ]);
  });

  it("ignores braces that aren't a positional variable", () => {
    expect(slots("Save {{ok}} and {x} and {{}}")).toEqual([]);
  });
});

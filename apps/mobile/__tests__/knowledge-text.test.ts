/**
 * SOP instructions and notes are rich text from the web, edited on the phone
 * as plain text. What has to hold: the words survive both ways, lists stay
 * lists (numbered stays numbered), and nothing typed can become markup.
 */
import { hasFormatting, htmlToKnowledgeText, knowledgeBlocks, knowledgeTextToHtml } from "../src/knowledge-text";

it("turns typed text into paragraphs and lists", () => {
  expect(
    knowledgeTextToHtml(
      "Collect from Unit 4.\nRing first.\n\n- Never split the pallet\n- Approved couriers only\n\n1. Confirm\n2. Assign",
    ),
  ).toBe(
    "<p>Collect from Unit 4.<br>Ring first.</p><ul><li>Never split the pallet</li><li>Approved couriers only</li></ul><ol><li>Confirm</li><li>Assign</li></ol>",
  );
});

it("escapes anything that looks like markup", () => {
  expect(knowledgeTextToHtml("<script>alert(1)</script> & co")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</p>");
});

it("reads the web's HTML back as editable text", () => {
  const html =
    "<h2>Drop-off</h2><p>Collect from <strong>Unit 4</strong>.</p><ul><li>Never split the pallet</li></ul><ol><li>Confirm</li><li>Assign</li></ol>";
  expect(htmlToKnowledgeText(html)).toBe("Drop-off\n\nCollect from Unit 4.\n\n- Never split the pallet\n1. Confirm\n2. Assign");
});

it("round-trips what the phone wrote", () => {
  const typed = "First paragraph.\n\n- one\n- two";
  expect(htmlToKnowledgeText(knowledgeTextToHtml(typed))).toBe(typed);
});

it("knows when editing would drop the web's styling", () => {
  expect(hasFormatting("<p>Plain</p><ul><li>list</li></ul>")).toBe(false);
  expect(hasFormatting('<p>See <a href="https://x.example">the portal</a></p>')).toBe(true);
  expect(hasFormatting("<p><strong>Never</strong> split</p>")).toBe(true);
});

it("draws links and bold from stored HTML", () => {
  const [p] = knowledgeBlocks('<p><strong>Never</strong> split — <a href="https://x.example">portal</a></p>');
  expect(p!.spans.some((s) => s.bold && s.text === "Never")).toBe(true);
  expect(p!.spans.some((s) => s.href === "https://x.example")).toBe(true);
});

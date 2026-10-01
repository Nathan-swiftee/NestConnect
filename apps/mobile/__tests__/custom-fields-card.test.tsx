/**
 * The channel's own fields, on the phone's thread details.
 *
 * The web has shown these beside every conversation since custom fields
 * existed. The phone showed none of them — which is the half that matters: an
 * order number arrives from an app's SDK and attaches itself to the thread
 * before anybody has spoken, and the person who needs to read it is holding a
 * phone looking at the message about that order.
 *
 * Rendered through jest-expo rather than asserted statically, because what was
 * wrong was not a value or a predicate: the rows were not in the tree at all.
 */
import { fireEvent, render } from "@testing-library/react-native";
import type { CustomField, CustomFieldValue } from "@ding/schemas";

// `mock`-prefixed, because a jest.mock factory is hoisted above everything
// else in the file and may only reach variables named this way.
const mockSetValues = jest.fn();
const mockState: {
  fields: CustomField[];
  conv: CustomFieldValue[];
  contact: CustomFieldValue[];
} = { fields: [], conv: [], contact: [] };

// The theme reaches for the stored appearance preference, which has no native
// module here.
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

jest.mock("@ding/client", () => ({
  useCustomFields: () => ({ data: mockState.fields }),
  useCustomFieldValues: (entity: string) => ({
    data: entity === "conversation" ? mockState.conv : mockState.contact,
  }),
  useSetCustomFieldValues: () => ({ mutate: mockSetValues, isPending: false }),
}));

import { CustomFieldsCard } from "../src/components/CustomFieldsCard";

const field = (over: Partial<CustomField> & Pick<CustomField, "key" | "label">): CustomField => ({
  id: `cf_${over.key}`,
  type: "text",
  entity: "conversation",
  options: [],
  inboxIds: [],
  position: 0,
  filterable: false,
  archived: false,
  ...over,
});

const card = () =>
  render(<CustomFieldsCard inboxId="ib_ding" conversationId="cv_1" contactId="ct_1" />);

beforeEach(() => {
  mockSetValues.mockClear();
  mockState.fields = [];
  mockState.conv = [];
  mockState.contact = [];
});

it("shows the channel's fields and what they hold", () => {
  mockState.fields = [field({ key: "order_id", label: "Order number" })];
  mockState.conv = [{ fieldId: "cf_order_id", key: "order_id", value: "DG-88412" }];

  const view = card();
  expect(view.queryByText("Order number")).not.toBeNull();
  expect(view.queryByText("DG-88412")).not.toBeNull();
});

it("gives an empty field a row of its own, to be filled in", () => {
  mockState.fields = [field({ key: "order_id", label: "Order number" })];

  const view = card();
  expect(view.queryByText("Order number")).not.toBeNull();
  // The gap is the information. A field with no value and no row is a field
  // nobody knows they were meant to fill in.
  expect(view.queryByText("—")).not.toBeNull();
});

it("writes what is typed against the conversation", () => {
  mockState.fields = [field({ key: "order_id", label: "Order number" })];

  const view = card();
  fireEvent.press(view.getByLabelText("Order number: not set"));
  fireEvent.changeText(view.getByLabelText("Order number"), "DG-99001");
  // Two steps, not one `act`: the typing has to be committed before the done
  // key is pressed, or the handler that fires still closes over an empty draft
  // and decides nothing changed.
  fireEvent(view.getByLabelText("Order number"), "submitEditing");

  expect(mockSetValues).toHaveBeenCalledWith(
    { entity: "conversation", entityId: "cv_1", values: { order_id: "DG-99001" } },
    expect.anything(),
  );
});

it("clears a field to null rather than to an empty string", () => {
  mockState.fields = [field({ key: "order_id", label: "Order number" })];
  mockState.conv = [{ fieldId: "cf_order_id", key: "order_id", value: "DG-88412" }];

  const view = card();
  fireEvent.press(view.getByLabelText("Order number: DG-88412"));
  fireEvent.changeText(view.getByLabelText("Order number"), "   ");
  // Two steps, not one `act`: the typing has to be committed before the done
  // key is pressed, or the handler that fires still closes over an empty draft
  // and decides nothing changed.
  fireEvent(view.getByLabelText("Order number"), "submitEditing");

  // Deleting the value, not storing a blank one.
  expect(mockSetValues).toHaveBeenCalledWith(
    { entity: "conversation", entityId: "cv_1", values: { order_id: null } },
    expect.anything(),
  );
});

it("writes a contact field against the customer, not the thread", () => {
  mockState.fields = [field({ key: "account_ref", label: "Account", entity: "contact" })];

  const view = card();
  fireEvent.press(view.getByLabelText("Account: not set"));
  fireEvent.changeText(view.getByLabelText("Account"), "AC-7781");
  // Two steps, not one `act`: the typing has to be committed before the done
  // key is pressed, or the handler that fires still closes over an empty draft
  // and decides nothing changed.
  fireEvent(view.getByLabelText("Account"), "submitEditing");

  expect(mockSetValues).toHaveBeenCalledWith(
    { entity: "contact", entityId: "ct_1", values: { account_ref: "AC-7781" } },
    expect.anything(),
  );
});

it("offers a select field's choices rather than a free-text box", () => {
  mockState.fields = [
    field({ key: "reason", label: "Reason", type: "select", options: ["Late", "Missing", "Cold"] }),
  ];

  const view = card();
  fireEvent.press(view.getByLabelText("Reason: not set"));
  expect(view.queryByText("Missing")).not.toBeNull();
  fireEvent.press(view.getByText("Missing"));

  expect(mockSetValues).toHaveBeenCalledWith(
    { entity: "conversation", entityId: "cv_1", values: { reason: "Missing" } },
    expect.anything(),
  );
});

it("draws nothing at all when the channel has no fields", () => {
  const view = card();
  // A section that is always there and always empty teaches people to stop
  // looking at it.
  expect(view.toJSON()).toBeNull();
});

it("leaves out a field another channel owns, and archived ones", () => {
  mockState.fields = [
    field({ key: "order_id", label: "Order number", inboxIds: ["ib_other"] }),
    field({ key: "old_ref", label: "Old reference", archived: true }),
    field({ key: "driver", label: "Driver", inboxIds: ["ib_ding"] }),
  ];

  const view = card();
  expect(view.queryByText("Order number")).toBeNull();
  expect(view.queryByText("Old reference")).toBeNull();
  expect(view.queryByText("Driver")).not.toBeNull();
});

/**
 * And that something renders it.
 *
 * Tautological-looking, and it is the exact failure this change is for: the
 * component the web uses has existed all along, worked, and was not on the
 * phone's details sheet. A card nothing mounts passes every test above.
 *
 * Read statically rather than by rendering `DetailsPanel`, which is a `Modal`
 * with a dozen queries behind it — this asserts the wiring, and the tests above
 * assert the behaviour.
 */
it("is mounted by the thread's details sheet", () => {
  const panel = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../src/components/DetailsPanel.tsx"),
    "utf8",
  ) as string;
  expect(panel).toMatch(/<CustomFieldsCard[\s\S]*?inboxId=\{conv\.inboxId\}/);
  expect(panel).toMatch(/conversationId=\{conv\.id\}/);
  expect(panel).toMatch(/contactId=\{conv\.contact\.id\}/);
});

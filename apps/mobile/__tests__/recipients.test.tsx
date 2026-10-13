/**
 * The address field behind email Forward and Cc/Bcc on the phone: customers
 * are suggested as you type, any address can still be typed in, and each
 * becomes a removable chip.
 */
import { fireEvent, render } from "@testing-library/react-native";
import type { Contact } from "@ding/schemas";
import { RecipientInput } from "../src/components/RecipientInput";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 } },
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
}));

const contact = (id: string, displayName: string, email: string | undefined, company?: string) =>
  ({ id, displayName, email, company, tags: [], avatarColor: "#3B82F6" }) as unknown as Contact;
const contacts = [
  contact("c1", "Marta Kowalska", "marta@northside.io", "Northside Logistics"),
  contact("c2", "Mark Doyle", "mark@acme.co"),
  contact("c3", "No Email", undefined),
];

describe("RecipientInput", () => {
  it("suggests customers as you type and adds the one you tap", () => {
    const onChange = jest.fn();
    const view = render(<RecipientInput value={[]} onChange={onChange} contacts={contacts} label="Forward to" />);
    fireEvent.changeText(view.getByLabelText("Forward to"), "mart");
    expect(view.getByText("Marta Kowalska")).toBeTruthy();
    expect(view.queryByText("Mark Doyle")).toBeNull();
    fireEvent.press(view.getByLabelText("Add Marta Kowalska, marta@northside.io"));
    expect(onChange).toHaveBeenCalledWith(["marta@northside.io"]);
  });

  it("takes a typed address when you finish it with a comma", () => {
    const onChange = jest.fn();
    const view = render(<RecipientInput value={[]} onChange={onChange} contacts={contacts} label="Cc" />);
    fireEvent.changeText(view.getByLabelText("Cc"), "Accounts@Supplier.com,");
    expect(onChange).toHaveBeenCalledWith(["accounts@supplier.com"]);
  });

  it("doesn't turn a half-typed name into a chip when the field loses focus", () => {
    // Tapping a suggestion blurs the field first; "mar" must survive for the tap.
    const onChange = jest.fn();
    const view = render(<RecipientInput value={[]} onChange={onChange} contacts={contacts} label="Cc" />);
    const input = view.getByLabelText("Cc");
    fireEvent.changeText(input, "mar");
    fireEvent(input, "blur");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.press(view.getByLabelText("Add Mark Doyle, mark@acme.co"));
    expect(onChange).toHaveBeenCalledWith(["mark@acme.co"]);
  });

  it("but does keep a finished address on blur", () => {
    const onChange = jest.fn();
    const view = render(<RecipientInput value={[]} onChange={onChange} contacts={contacts} label="Cc" />);
    const input = view.getByLabelText("Cc");
    fireEvent.changeText(input, "ops@supplier.com");
    fireEvent(input, "blur");
    expect(onChange).toHaveBeenCalledWith(["ops@supplier.com"]);
  });

  it("shows a known address by name, and removes a chip", () => {
    const onChange = jest.fn();
    const view = render(
      <RecipientInput value={["marta@northside.io", "bad-address"]} onChange={onChange} contacts={contacts} label="Cc" />,
    );
    expect(view.getByText("Marta Kowalska")).toBeTruthy();
    expect(view.getByText("bad-address")).toBeTruthy();
    fireEvent.press(view.getByLabelText("Remove bad-address"));
    expect(onChange).toHaveBeenCalledWith(["marta@northside.io"]);
  });

  it("doesn't suggest someone already added", () => {
    const view = render(<RecipientInput value={["marta@northside.io"]} onChange={() => {}} contacts={contacts} label="Cc" />);
    fireEvent.changeText(view.getByLabelText("Cc"), "mar");
    expect(view.queryByLabelText("Add Marta Kowalska, marta@northside.io")).toBeNull();
    expect(view.getByLabelText("Add Mark Doyle, mark@acme.co")).toBeTruthy();
  });
});

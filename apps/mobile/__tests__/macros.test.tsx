/**
 * Macros on the phone: the sheet lists a chat's saved replies as they'll read
 * in that chat, and picking one hands it back to the composer (it never sends).
 */
import { fireEvent, render } from "@testing-library/react-native";
import { MacroSheet } from "../src/components/MacroSheet";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
// The sheet's drag-to-dismiss needs a native gesture module; what's tested is its contents.
jest.mock("../src/components/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: unknown }) => (visible ? children : null),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 } },
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
}));

const macro = (id: string, name: string, shortcut: string | null, body: string) => ({
  id,
  name,
  shortcut,
  body,
  teamIds: [],
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  updatedBy: null,
});
const macros = [
  macro("mac_1", "Delivery delayed", "delayed", "Hi {{contact.first_name}}, sorry — it's running late. {{agent.first_name}}"),
  macro("mac_2", "Opening hours", "hours", "We're open 9–5."),
];
const fill = { contactName: "Marta Kowalska", agentName: "Nathan A" };

describe("MacroSheet", () => {
  it("shows each macro filled in for this chat", () => {
    const view = render(<MacroSheet macros={macros} fill={fill} visible onPick={() => {}} onClose={() => {}} />);
    expect(view.getByText("Delivery delayed")).toBeTruthy();
    expect(view.getByText("/delayed")).toBeTruthy();
    expect(view.getByText("Hi Marta, sorry — it's running late. Nathan")).toBeTruthy();
    expect(view.queryByText(/\{\{/)).toBeNull();
  });

  it("hands the picked macro back rather than sending it", () => {
    const onPick = jest.fn();
    const view = render(<MacroSheet macros={macros} fill={fill} visible onPick={onPick} onClose={() => {}} />);
    fireEvent.press(view.getByLabelText("Insert Opening hours"));
    expect(onPick).toHaveBeenCalledWith(macros[1]);
  });

  it("says so when the team has none", () => {
    const view = render(<MacroSheet macros={[]} fill={fill} visible onPick={() => {}} onClose={() => {}} />);
    expect(view.getByText(/No macros for this team yet/)).toBeTruthy();
  });
});

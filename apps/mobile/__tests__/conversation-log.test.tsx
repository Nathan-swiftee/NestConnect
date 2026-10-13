/**
 * The conversation log sheet, reached from Details.
 *
 * What it has to get right is small: each entry reads as the server wrote it,
 * with its second line and a snooze's "until" where there is one, and an empty
 * log says what will appear rather than showing nothing. And it only asks the
 * server while it's open.
 */
import { render } from "@testing-library/react-native";
import type { ConversationEvent } from "@ding/schemas";

const mockState: { events: ConversationEvent[] | undefined; enabled: boolean[] } = { events: [], enabled: [] };

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

jest.mock("../src/components/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: unknown }) => (visible ? children : null),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 } },
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
}));

jest.mock("@ding/client", () => ({
  ...jest.requireActual("../../../packages/client/src/format"),
  useConversationEvents: (_id: string, enabled: boolean) => {
    mockState.enabled.push(enabled);
    return { data: mockState.events, isLoading: false, isError: false };
  },
}));

// The photo URL helper drags in the sound module, which has no native side here.
jest.mock("../src/api-config", () => ({ mediaSource: (uri: string) => ({ uri }) }));

import { ConversationLogSheet } from "../src/components/ConversationLogSheet";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const event = (over: Partial<ConversationEvent> & Pick<ConversationEvent, "id" | "text">): ConversationEvent => ({
  type: "assigned",
  at: ago(5),
  actor: { kind: "system" },
  detail: null,
  until: null,
  ...over,
});

beforeEach(() => {
  mockState.events = [];
  mockState.enabled = [];
});

it("lists what happened, with the second line and when", () => {
  mockState.events = [
    event({
      id: "e2",
      type: "assigned",
      text: "Nathan A assigned it to James",
      detail: "Was Amara",
      actor: { kind: "agent", id: "u1", name: "Nathan A", avatarColor: null, avatarUrl: null },
      at: ago(3),
    }),
    event({ id: "e1", type: "routed", text: "Routed to Sales team", detail: "Via their organisation, Acme Ltd", at: ago(120) }),
  ];
  const view = render(<ConversationLogSheet conversationId="cv_1" visible onClose={() => {}} />);
  expect(view.queryByText("Conversation log")).not.toBeNull();
  expect(view.queryByText("Nathan A assigned it to James")).not.toBeNull();
  expect(view.queryByText("Was Amara")).not.toBeNull();
  expect(view.queryByText("Via their organisation, Acme Ltd")).not.toBeNull();
  expect(view.queryByText("3m ago")).not.toBeNull();
  expect(view.queryByText("2h ago")).not.toBeNull();
});

it("shows until when a snooze ends", () => {
  mockState.events = [event({ id: "e1", type: "snoozed", text: "James snoozed it", until: new Date().toISOString() })];
  const view = render(<ConversationLogSheet conversationId="cv_1" visible onClose={() => {}} />);
  expect(view.queryByText(/^Until Today/)).not.toBeNull();
});

it("says what will show up when nothing has yet", () => {
  const view = render(<ConversationLogSheet conversationId="cv_1" visible onClose={() => {}} />);
  expect(view.queryByText(/Nothing logged yet/)).not.toBeNull();
});

it("only fetches while open", () => {
  render(<ConversationLogSheet conversationId="cv_1" visible={false} onClose={() => {}} />);
  expect(mockState.enabled.every((e) => e === false)).toBe(true);
});

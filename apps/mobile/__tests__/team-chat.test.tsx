/**
 * Team Chat on the phone: the list of chats, and one message.
 *
 * The list has to read like WhatsApp's at a glance — who, the last thing said
 * (with "You:" or the sender in a group), a green count of what's waiting, and
 * a flag when an unread message mentions me. A bubble has to say who sent it in
 * a group, show the quote it answers, the reactions under it, and turn its
 * ticks blue only once everyone else has read it.
 *
 * Rendered through jest-expo, with the shared client stubbed: the rules behind
 * these (ticks, previews, runs) are tested on their own in the web's
 * chat-format tests and on the server.
 */
import { fireEvent, render } from "@testing-library/react-native";
import type { ChatMember, ChatMessage, ChatRoomSummary } from "@ding/schemas";

const mockState: { rooms: ChatRoomSummary[]; pushed: unknown[] } = { rooms: [], pushed: [] };

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 } },
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
}));
jest.mock("expo-router", () => ({
  useSegments: () => [],
  router: { navigate: () => {}, push: (to: unknown) => mockState.pushed.push(to) },
}));
jest.mock("../src/components/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: unknown }) => (visible ? children : null),
}));
// The swipe needs a gesture handler root; what's under test is the bubble.
jest.mock("../src/components/SwipeToReply", () => ({
  SwipeToReply: ({ children }: { children: unknown }) => children,
}));
jest.mock("../src/api-config", () => ({ mediaSource: (uri: string) => ({ uri }) }));

jest.mock("@ding/client", () => {
  const format = jest.requireActual("../../../packages/client/src/format");
  const chatFormat = jest.requireActual("../../../packages/client/src/chat-format");
  return {
    ...format,
    ...chatFormat,
    api: {},
    useMe: () => ({ data: { user: { id: "me", name: "Nathan A", role: "agent" } } }),
    usePeople: () => ({ data: [{ user: { id: "me", name: "Nathan A", email: "nathan@x.co" }, teamIds: [] }] }),
    useTeams: () => ({ data: [{ id: "team_ops", name: "Ops team", icon: "truck" }] }),
    useChatStatus: () => ({ data: { enabled: true, canCreateGroups: false, canOversee: false, unread: 3 } }),
    useChatRooms: () => ({ data: mockState.rooms, isLoading: false, isError: false }),
    useChatMutation: () => ({ mutate: () => {}, isPending: false }),
  };
});

import Chat from "../app/(app)/(tabs)/chat";
import { ChatBubbleRow } from "../src/components/chat/ChatBubble";

const at = new Date().toISOString();
const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m1",
  roomId: "r1",
  kind: "text",
  author: { id: "amara", name: "Amara Jones", avatarColor: null, avatarUrl: null },
  body: "On my way",
  system: null,
  replyTo: null,
  reactions: [],
  mentions: [],
  editedAt: null,
  deletedAt: null,
  createdAt: at,
  ...over,
});
const room = (over: Partial<ChatRoomSummary>): ChatRoomSummary => ({
  id: "r1",
  kind: "group",
  name: "Dispatch London",
  emoji: "🚚",
  teamId: null,
  other: null,
  memberCount: 3,
  lastMessage: msg({}),
  lastActivityAt: at,
  unread: 0,
  mentioned: false,
  pinned: false,
  muted: false,
  isMember: true,
  archived: false,
  ...over,
});
const member = (id: string, read: string | null): ChatMember => ({
  id,
  name: id,
  avatarColor: null,
  avatarUrl: null,
  role: "member",
  lastReadAt: read,
  lastDeliveredAt: null,
  online: false,
  lastSeenAt: null,
});

beforeEach(() => {
  mockState.rooms = [];
  mockState.pushed = [];
});

describe("the list of chats", () => {
  it("shows who said what last, and how many are waiting", () => {
    mockState.rooms = [
      room({ unread: 3, mentioned: true, lastMessage: msg({ body: "@nathan can you take this?" }) }),
      room({ id: "r2", kind: "direct", name: "James", emoji: null, other: { id: "james", name: "James", avatarColor: null, avatarUrl: null, online: true, lastSeenAt: null }, lastMessage: msg({ author: { id: "me", name: "Nathan A", avatarColor: null, avatarUrl: null }, body: "Thanks!" }) }),
    ];
    const view = render(<Chat />);
    expect(view.queryByText("Dispatch London")).not.toBeNull();
    expect(view.queryByText("Amara: @Nathan A can you take this?")).not.toBeNull();
    expect(view.queryByText("3")).not.toBeNull();
    expect(view.queryByText("@")).not.toBeNull();
    // Mine, in a direct chat: "You:"
    expect(view.queryByText("You: Thanks!")).not.toBeNull();
    expect(view.queryByLabelText("Online")).not.toBeNull();
  });

  it("filters to unread", () => {
    mockState.rooms = [room({ unread: 2 }), room({ id: "r2", name: "Quiet group", unread: 0 })];
    const view = render(<Chat />);
    fireEvent.press(view.getByText("Unread 1"));
    expect(view.queryByText("Dispatch London")).not.toBeNull();
    expect(view.queryByText("Quiet group")).toBeNull();
  });

  it("opens a chat", () => {
    mockState.rooms = [room({})];
    const view = render(<Chat />);
    fireEvent.press(view.getByLabelText("Dispatch London"));
    expect(mockState.pushed).toEqual([{ pathname: "/(app)/chat/[id]", params: { id: "r1" } }]);
  });

  it("an agent isn't offered All chats", () => {
    const view = render(<Chat />);
    expect(view.queryByLabelText("All chats in the workspace")).toBeNull();
    expect(view.queryByLabelText("New chat")).not.toBeNull();
  });
});

describe("a message", () => {
  const props = {
    first: true,
    last: true,
    meId: "me",
    people: [],
    canAct: true,
    onReply: () => {},
    onLongPress: () => {},
    onReact: () => {},
    onQuote: () => {},
    onRetry: () => {},
  };

  it("in a group, says who sent it, and the quote it answers", () => {
    const m = msg({ replyTo: { id: "q", authorId: "me", authorName: "Nathan A", body: "Who's on the 2pm?", deleted: false } });
    const view = render(<ChatBubbleRow {...props} m={m} mine={false} group members={[]} />);
    expect(view.queryByText("Amara Jones")).not.toBeNull();
    expect(view.queryByText("You")).not.toBeNull();
    expect(view.queryByText("Who's on the 2pm?")).not.toBeNull();
  });

  it("ticks go blue only once everyone else has read it", () => {
    const later = new Date(Date.now() + 60_000).toISOString();
    const mine = msg({ author: { id: "me", name: "Nathan A", avatarColor: null, avatarUrl: null } });
    let view = render(<ChatBubbleRow {...props} m={mine} mine group members={[member("me", null), member("a", later), member("b", null)]} />);
    expect(view.queryByLabelText("Read")).toBeNull();
    view = render(<ChatBubbleRow {...props} m={mine} mine group members={[member("me", null), member("a", later), member("b", later)]} />);
    expect(view.queryByLabelText("Read")).not.toBeNull();
  });

  it("shows reactions, and a deleted message as deleted", () => {
    const view = render(<ChatBubbleRow {...props} m={msg({ reactions: [{ emoji: "👍", userIds: ["me", "b"] }] })} mine={false} group={false} members={[]} />);
    expect(view.queryByLabelText("👍 2")).not.toBeNull();
    const gone = render(<ChatBubbleRow {...props} m={msg({ deletedAt: at, body: "" })} mine={false} group={false} members={[]} />);
    expect(gone.queryByText("This message was deleted")).not.toBeNull();
  });
});

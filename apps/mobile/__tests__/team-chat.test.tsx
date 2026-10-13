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
import { act, fireEvent, render } from "@testing-library/react-native";
import type { ChatMember, ChatMessage, ChatRoomSummary } from "@ding/schemas";

const mockState: { rooms: ChatRoomSummary[]; pushed: unknown[]; hits: unknown[]; discussions: unknown[] } = { rooms: [], pushed: [], hits: [], discussions: [] };

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
// What's in the bubble is under test, not the photo viewer and audio player behind it.
jest.mock("../src/components/Attachments", () => {
  const { Text } = jest.requireActual("react-native");
  return { Attachments: ({ items }: { items: Array<{ filename: string }> }) => items.map((a) => <Text key={a.filename}>{`file:${a.filename}`}</Text>) };
});

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
    useChatSearch: (q: string) => ({ data: q.length >= 2 ? mockState.hits : [] }),
    useChatStarred: () => ({ data: [], isLoading: false, isError: false }),
    useChatDiscussions: () => ({ data: mockState.discussions }),
  };
});

import Chat from "../app/(app)/(tabs)/chat";
import { ChatBubbleRow } from "../src/components/chat/ChatBubble";
import { DiscussionBar } from "../src/components/chat/Discuss";

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
  attachments: [],
  link: null,
  shared: null,
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
  mockState.hits = [];
  mockState.discussions = [];
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

  it("says what a photo or voice note was, when it's the last message", () => {
    const photo = { id: "a1", kind: "image" as const, mime: "image/jpeg", size: 1, filename: "van.jpg", url: "/api/media/a1" };
    const note = { ...photo, id: "a2", kind: "voice" as const, filename: "v.m4a", durationMs: 9_000 };
    mockState.rooms = [
      room({ lastMessage: msg({ body: "", attachments: [photo] }) }),
      room({ id: "r2", kind: "direct", name: "James", emoji: null, lastMessage: msg({ body: "", attachments: [note] }) }),
    ];
    const view = render(<Chat />);
    expect(view.queryByText("Amara: 📷 Photo")).not.toBeNull();
    expect(view.queryByText("🎤 Voice message (0:09)")).not.toBeNull();
  });

  it("searches messages as well as chats, and opens a hit at the message", () => {
    jest.useFakeTimers();
    mockState.rooms = [room({})];
    mockState.hits = [{ roomId: "r1", roomName: "Dispatch London", roomKind: "group", message: msg({ id: "m9", body: "The van keys are in the drawer" }) }];
    const view = render(<Chat />);
    fireEvent.changeText(view.getByLabelText("Search chats and messages"), "van keys");
    act(() => jest.advanceTimersByTime(300));
    expect(view.queryByText("Messages")).not.toBeNull();
    fireEvent.press(view.getByLabelText("Message in Dispatch London"));
    expect(mockState.pushed).toEqual([{ pathname: "/(app)/chat/[id]", params: { id: "r1", mid: "m9" } }]);
    jest.useRealTimers();
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

  it("carries its files, a card for its link, and a star", () => {
    const photo = { id: "a1", kind: "image" as const, mime: "image/jpeg", size: 1, filename: "van.jpg", url: "/api/media/a1" };
    const m = msg({ body: "Rota https://nest.example/rota", attachments: [photo], link: { url: "https://nest.example/rota", title: "Rota & shifts", description: "Who's on", siteName: "nest.example" } });
    const view = render(<ChatBubbleRow {...props} m={m} mine={false} group={false} members={[]} starred />);
    expect(view.queryByText("file:van.jpg")).not.toBeNull();
    expect(view.queryByText("Rota & shifts")).not.toBeNull();
    expect(view.queryByLabelText("Starred")).not.toBeNull();
    const plain = render(<ChatBubbleRow {...props} m={msg({})} mine={false} group={false} members={[]} />);
    expect(plain.queryByLabelText("Starred")).toBeNull();
  });

  it("a photo on its own has no empty line of text", () => {
    const photo = { id: "a1", kind: "image" as const, mime: "image/jpeg", size: 1, filename: "van.jpg", url: "/api/media/a1" };
    const view = render(<ChatBubbleRow {...props} m={msg({ body: "", attachments: [photo] })} mine={false} group={false} members={[]} />);
    expect(view.toJSON()).toBeTruthy();
    expect(view.queryByText("file:van.jpg")).not.toBeNull();
  });

  it("shows reactions, and a deleted message as deleted", () => {
    const view = render(<ChatBubbleRow {...props} m={msg({ reactions: [{ emoji: "👍", userIds: ["me", "b"] }] })} mine={false} group={false} members={[]} />);
    expect(view.queryByLabelText("👍 2")).not.toBeNull();
    const gone = render(<ChatBubbleRow {...props} m={msg({ deletedAt: at, body: "" })} mine={false} group={false} members={[]} />);
    expect(gone.queryByText("This message was deleted")).not.toBeNull();
  });
});

describe("a customer conversation, discussed", () => {
  const shared = {
    conversationId: "conv_north",
    contactName: "Northside Logistics",
    contactAvatarColor: null,
    channel: "whatsapp" as const,
    subject: null,
    status: "closed" as const,
    assigneeName: "Amara",
    quote: { messageId: "m1", authorName: "Northside Logistics", body: "Is the VAT rate right?", internal: false, at },
  };
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

  it("a card says who, what was asked, where it stands — and opens the conversation", () => {
    const view = render(<ChatBubbleRow {...props} m={msg({ body: "Can someone check?", shared })} mine={false} group={false} members={[]} />);
    // Its name, and again as who asked the quoted question.
    expect(view.getAllByText("Northside Logistics").length).toBe(2);
    expect(view.queryByText("Is the VAT rate right?")).not.toBeNull();
    expect(view.queryByText("✓ Resolved")).not.toBeNull();
    expect(view.queryByText("Assigned to Amara")).not.toBeNull();
    expect(view.queryByText("Can someone check?")).not.toBeNull();
    fireEvent.press(view.getByLabelText("Northside Logistics, open the conversation"));
    expect(mockState.pushed).toEqual([{ pathname: "/(app)/thread/[id]", params: { id: "conv_north" } }]);
  });

  it("a card for a deleted conversation says so, and goes nowhere", () => {
    const view = render(<ChatBubbleRow {...props} m={msg({ body: "", shared: { ...shared, status: null, assigneeName: null } })} mine={false} group={false} members={[]} />);
    expect(view.queryByText("This conversation was deleted")).not.toBeNull();
    expect(view.queryByLabelText("Northside Logistics, open the conversation")).toBeNull();
  });

  it("the thread's bar says where it's discussed, and the latest word", () => {
    const opened: string[] = [];
    mockState.discussions = [
      {
        roomId: "r1",
        roomName: "Support team",
        roomKind: "team",
        canPost: true,
        card: msg({ id: "card1", shared }),
        replies: 2,
        latest: msg({ id: "x", body: "Reissuing it now" }),
      },
    ];
    const view = render(<DiscussionBar conversationId="conv_north" onOpen={(id) => opened.push(id)} />);
    expect(view.queryByText("Amara: Reissuing it now")).not.toBeNull();
    fireEvent.press(view.getByLabelText("Discussed in Support team, 2 replies"));
    expect(opened).toEqual(["card1"]);
  });

  it("no discussions, no bar", () => {
    const view = render(<DiscussionBar conversationId="conv_north" onOpen={() => {}} />);
    expect(view.toJSON()).toBeNull();
  });
});

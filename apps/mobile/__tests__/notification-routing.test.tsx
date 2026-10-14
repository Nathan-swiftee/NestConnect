import { renderHook } from "@testing-library/react-native";

/**
 * Tapping a push opens what it was about — every time, not just the first.
 *
 * Pinned because the failure was invisible from the code: our pushes carry a
 * collapse id per chat and per conversation, iOS uses that as the request
 * identifier, and the tap de-duplication keyed on the identifier. The first tap
 * opened the chat; every later one for the same chat was dropped as a
 * duplicate and the app just came to the front on whatever screen it was on.
 */
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

let mockListener: ((r: unknown) => void) | null = null;
let mockLast: unknown = null;
jest.mock("expo-notifications", () => ({
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  getLastNotificationResponseAsync: () => Promise.resolve(mockLast),
  addNotificationResponseReceivedListener: (fn: (r: unknown) => void) => {
    mockListener = fn;
    return { remove: () => (mockListener = null) };
  },
}));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("@ding/client", () => ({ api: { markRead: jest.fn() } }));
jest.mock("../src/send-queue", () => ({ enqueue: jest.fn() }));
jest.mock("../src/session", () => ({ loadSession: jest.fn() }));

import { useNotificationRouting } from "../src/notification-routing";

const DEFAULT = "expo.modules.notifications.actions.DEFAULT";
const tap = (identifier: string, date: number, data: Record<string, string>, actionIdentifier = DEFAULT) => ({
  actionIdentifier,
  notification: { date, request: { identifier, content: { data } } },
});

beforeEach(() => {
  mockPush.mockClear();
  mockListener = null;
  mockLast = null;
});

it("opens the chat for each push about it, though they share an identifier", async () => {
  renderHook(() => useNotificationRouting(true));
  await Promise.resolve();
  mockListener!(tap("chat:room_1", 1000, { kind: "chat_message", chatRoomId: "room_1" }));
  mockListener!(tap("chat:room_1", 2000, { kind: "chat_message", chatRoomId: "room_1" }));
  expect(mockPush).toHaveBeenCalledTimes(2);
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/(app)/chat/[id]", params: { id: "room_1" } });
});

it("opens the thread for each push about a conversation", async () => {
  renderHook(() => useNotificationRouting(true));
  await Promise.resolve();
  mockListener!(tap("conversation:c1", 1000, { kind: "message", conversationId: "c1" }));
  mockListener!(tap("conversation:c1", 2000, { kind: "message", conversationId: "c1" }));
  expect(mockPush).toHaveBeenCalledTimes(2);
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/(app)/thread/[id]", params: { id: "c1" } });
});

it("still opens a cold-start tap once when the listener repeats it", async () => {
  const response = tap("chat:room_2", 3000, { kind: "chat_message", chatRoomId: "room_2" });
  mockLast = response;
  renderHook(() => useNotificationRouting(true));
  await Promise.resolve();
  await Promise.resolve();
  mockListener!(response);
  expect(mockPush).toHaveBeenCalledTimes(1);
});

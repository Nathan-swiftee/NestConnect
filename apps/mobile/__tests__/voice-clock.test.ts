import { act, renderHook } from "@testing-library/react-native";
import { useVoiceRecording } from "../src/voice";

/**
 * The recorder is only read while it is recording.
 *
 * This is a regression test with a specific regression behind it. expo-audio's
 * `useAudioRecorderState` opens a `setInterval` on mount and never closes it,
 * and its effect depends on the recorder's id alone — so it polls `getStatus()`
 * forever, at whatever rate it was first given, whether or not anything is being
 * recorded.
 *
 * That was harmless while the engine lived inside the panel you tapped open: it
 * mounted with the recording and unmounted with it. Hoisting the engine to the
 * composer so a *held* microphone could drive it took the interval along, and it
 * spent the life of every open conversation calling into the native recorder
 * four times a second to report that nothing was happening.
 *
 * Two reasons that matters enough to pin. It is pure waste on the hottest screen
 * in the app. And `getStatus()` is synchronous on the JS thread while
 * `prepareToRecordAsync` runs `MediaRecorder.prepare()` on a coroutine, so a
 * free-running interval can reach a non-thread-safe `MediaRecorder` while it is
 * being prepared — which the panel arrangement made almost impossible, its first
 * tick landing 250ms after the same mount that started preparing.
 *
 * So the property is not "the clock works". It is *when the recorder is touched
 * at all*, which no rendering test would notice and which is invisible on a
 * screen that looks perfectly correct either way.
 */

const mockGetStatus = jest.fn(() => ({
  durationMillis: 0,
  isRecording: true,
  canRecord: true,
  url: null,
}));

const mockRecorder = {
  id: "rec-1",
  uri: "file:///voice.m4a",
  currentTime: 0,
  isRecording: true,
  getStatus: mockGetStatus,
  prepareToRecordAsync: jest.fn(async () => {}),
  record: jest.fn(),
  stop: jest.fn(async () => {}),
  pause: jest.fn(),
};

jest.mock("expo-audio", () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setAudioModeAsync: jest.fn(async () => {}),
  useAudioRecorder: () => mockRecorder,
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(async () => {}),
    getItem: jest.fn(async () => null),
    removeItem: jest.fn(async () => {}),
  },
}));

beforeEach(() => {
  mockGetStatus.mockClear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test("an idle recorder is never polled", async () => {
  renderHook(() => useVoiceRecording());

  // Several seconds of a conversation being open with nobody recording. The
  // old arrangement made 40 native calls in this window.
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });

  expect(mockGetStatus).not.toHaveBeenCalled();
});

test("the clock runs once recording starts", async () => {
  const { result } = renderHook(() => useVoiceRecording());

  await act(async () => {
    await result.current.start();
  });

  const afterStart = mockGetStatus.mock.calls.length;
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });

  expect(mockGetStatus.mock.calls.length).toBeGreaterThan(afterStart);
});

test("nothing polls the recorder while it is being prepared", async () => {
  const { result } = renderHook(() => useVoiceRecording());

  // The window this guards: permission, audio mode, prepare, record. A poll
  // landing inside it reaches a MediaRecorder mid-prepare from another thread.
  const duringStart: number[] = [];
  (mockRecorder.prepareToRecordAsync as jest.Mock).mockImplementationOnce(async () => {
    jest.advanceTimersByTime(5000);
    duringStart.push(mockGetStatus.mock.calls.length);
  });

  await act(async () => {
    await result.current.start();
  });

  expect(duringStart).toEqual([0]);
});

test("the clock stops again when the recording ends", async () => {
  const { result } = renderHook(() => useVoiceRecording());

  await act(async () => {
    await result.current.start();
  });
  await act(async () => {
    await result.current.stop();
  });

  mockGetStatus.mockClear();
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });

  expect(mockGetStatus).not.toHaveBeenCalled();
});

import { armTrail, beginTrail, endTrail, lastTrail, mark } from "../src/diagnostics";

/**
 * The breadcrumb trail that has to survive the app being killed.
 *
 * This is worth a test for one specific reason: the whole value of the trail is
 * a claim about *ordering* — that whatever is on disk when the process dies is
 * the sequence of steps that actually ran, ending at the one that killed it. If
 * a step can be lost, or land out of order, or linger from a previous run, the
 * trail doesn't merely under-report — it names the wrong call, and the next
 * round of debugging goes somewhere false with confidence. That is a worse
 * outcome than having no diagnostic at all, which is why the guarantee is
 * pinned here rather than assumed.
 *
 * A store that records every write, rather than the shipped mock, so the tests
 * can look at what would have been on disk *at the moment of the crash* instead
 * of only at the end.
 */
// `mock`-prefixed because jest hoists the factory above every other binding in
// the file, and only names that start with `mock` are allowed through.
let mockDisk: string | null = null;

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(async (_key: string, value: string) => {
      mockDisk = value;
    }),
    getItem: jest.fn(async () => mockDisk),
    removeItem: jest.fn(async () => {
      mockDisk = null;
    }),
  },
}));

/** What a crash at this instant would have left behind. */
const stepsOnDisk = (): string[] => (mockDisk ? (JSON.parse(mockDisk).steps as string[]) : []);

beforeEach(async () => {
  // `endTrail` first, to reset the module's in-memory copy too — clearing only
  // the fake disk would leave the previous test's steps in the array.
  await endTrail();
  mockDisk = null;
});

test("each step is on disk before the next one runs", async () => {
  // The sequence being modelled: mark, then make the risky call. The assertion
  // inside the "call" is the point — at the moment a native call would take the
  // process down, its own name is already persisted.
  await mark("perm");
  expect(stepsOnDisk()).toEqual(["perm"]);

  await mark("prepare");
  expect(stepsOnDisk()).toEqual(["perm", "prepare"]);

  await mark("record");
  // If `record()` killed the app right here, this is what the next launch reads.
  expect(stepsOnDisk()).toEqual(["perm", "prepare", "record"]);
});

test("a finished sequence leaves nothing behind", async () => {
  await beginTrail("press");
  await mark("record");
  await endTrail();

  expect(await lastTrail()).toBeNull();
});

test("a new attempt does not inherit the last one's steps", async () => {
  await beginTrail("press");
  await mark("record");
  // No `endTrail` — this attempt died. The next press must not read as a
  // sequence eight steps long that reached further than it did.
  await beginTrail("press");
  await mark("perm");

  expect(stepsOnDisk()).toEqual(["press", "perm"]);
});

test("an unawaited mark still lands, once a later step writes", async () => {
  // The render-commit effect can't await — effects aren't async. It appends
  // synchronously and relies on the next awaited step persisting the whole
  // list, which is what makes fire-and-forget safe in that one place.
  await beginTrail("press");
  void mark("overlay");
  await mark("record");

  expect(stepsOnDisk()).toEqual(["press", "overlay", "record"]);
});

test("the trail is read back in the order it ran", async () => {
  await beginTrail("press");
  await mark("haptic");
  await mark("start");
  await mark("perm");

  expect((await lastTrail())?.steps).toEqual(["press", "haptic", "start", "perm"]);
});

test("it stops growing rather than filling the disk", async () => {
  await beginTrail("press");
  for (let i = 0; i < 200; i += 1) await mark(`step-${i}`);

  const steps = (await lastTrail())?.steps ?? [];
  expect(steps.length).toBeLessThanOrEqual(40);
  // Capped at the front, not the back: the beginning of a sequence is what says
  // which path was taken, and a runaway loop only repeats the end.
  expect(steps[0]).toBe("press");
});

test("arming distinguishes a dead press from a bundle with no diagnostic", async () => {
  await armTrail();
  // The screen was alive and the press never reached JavaScript. Nothing at
  // all would instead mean the phone is running a bundle from before any of
  // this existed — a completely different conclusion.
  expect((await lastTrail())?.steps).toEqual(["armed"]);

  await mark("press");
  expect((await lastTrail())?.steps).toEqual(["armed", "press"]);
});

test("arming never overwrites the evidence it exists to preserve", async () => {
  // A crash left this behind. Reopening the conversation on the way to Settings
  // to read it must not wipe it — which is exactly what a plain `beginTrail` on
  // mount would do.
  await beginTrail("press");
  await mark("record");

  await armTrail();

  expect((await lastTrail())?.steps).toEqual(["press", "record"]);
});

test("nonsense on disk reads as no trail rather than throwing", async () => {
  mockDisk ="{not json";
  expect(await lastTrail()).toBeNull();

  mockDisk =JSON.stringify({ steps: "record", at: 5 });
  expect(await lastTrail()).toBeNull();
});

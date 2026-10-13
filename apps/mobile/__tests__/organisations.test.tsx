/**
 * Organisations on the phone: putting a customer into one (or a new one), and
 * filling an organisation with people from its own side — tick several, add.
 *
 * Rendered, because what's being checked is that the controls are there and
 * that pressing them sends the right request, not a value in isolation.
 */
import { act, fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";

const mockApi = {
  createAccount: jest.fn(async (input: { name: string }) => ({
    id: "acc_new",
    name: input.name,
  })),
  updateAccount: jest.fn(async (id: string, input: { name: string }) => ({
    id,
    name: input.name,
  })),
  archiveAccount: jest.fn(async () => ({})),
  deleteAccount: jest.fn(async () => ({ ok: true })),
  createAccountAlert: jest.fn(async () => ({})),
  deleteAccountAlert: jest.fn(async () => ({ ok: true })),
  createAccountSop: jest.fn(async (_id: string, input: { title: string }) => ({
    id: "sop_new",
    version: 1,
    ...input,
  })),
  updateAccountSop: jest.fn(async (_id: string, sopId: string) => ({
    id: sopId,
    version: 2,
  })),
  createAccountNote: jest.fn(async () => ({})),
  createAccountResource: jest.fn(async () => ({})),
  updateAccountContact: jest.fn(async () => ({})),
  linkAccountContact: jest.fn(async () => ({})),
  linkAccountContacts: jest.fn(async () => []),
  unlinkAccountContact: jest.fn(async () => ({ ok: true })),
};

const contact = (id: string, displayName: string, extra: Record<string, unknown> = {}) => ({
  id,
  displayName,
  phone: "+44 7700 900000",
  tags: [],
  ...extra,
});
const mockContacts = [
  contact("ct_ana", "Ana Acme"),
  contact("ct_ben", "Ben Bloom"),
  contact("ct_cat", "Cat Coast"),
  contact("ct_blocked", "Spam Bot", { blocked: true }),
];
const listItem = (id: string, name: string) => ({
  id,
  name,
  legalName: null,
  reference: null,
  summary: "",
  status: "active",
  tags: [],
  ownerUserId: null,
  ownerName: null,
  archivedAt: null,
  updatedAt: "2026-10-01T00:00:00.000Z",
  contactCount: 1,
  alertCount: 0,
  sopCount: 0,
});
const mockState: {
  linked: unknown[];
  accounts: unknown[];
  role: string;
  sops: unknown[];
  alerts: unknown[];
} = {
  linked: [],
  accounts: [],
  role: "admin",
  sops: [],
  alerts: [],
};

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 } },
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
}));
// Pulled in by the tab bar's height constant; nothing here navigates.
jest.mock("expo-router", () => ({
  useSegments: () => [],
  router: { navigate: () => {}, push: () => {} },
}));
// A WebView has no native module under jest; the viewer isn't what's tested.
jest.mock("../src/components/DocumentViewer", () => ({
  DocumentViewer: () => null,
}));
jest.mock("expo-document-picker", () => ({
  getDocumentAsync: async () => ({ canceled: true, assets: [] }),
}));

jest.mock("@ding/client", () => ({
  avatarBg: () => "#888",
  initials: (n: string) => n.slice(0, 2).toUpperCase(),
  // A getter: the factory runs when the components import the client, which
  // is before this file's own constants are assigned.
  get api() {
    return mockApi;
  },
  useContacts: () => ({ data: mockContacts, isLoading: false }),
  useAccounts: (q: { search?: string }) => ({
    data: (mockState.accounts as Array<{ name: string }>).filter(
      (a) => !q.search || a.name.toLowerCase().includes(q.search.toLowerCase()),
    ),
    isLoading: false,
  }),
  useContactAccounts: () => ({ data: mockState.linked }),
  relativeTime: () => "2d",
  useMe: () => ({ data: { user: { id: "usr_me", role: mockState.role } } }),
  usePeople: () => ({ data: [{ user: { id: "usr_me", name: "Nathan" }, teamIds: [] }] }),
  useTeams: () => ({ data: [] }),
  useAccountActivity: () => ({
    data: [
      {
        id: "ac1",
        actor: { id: "usr_me", name: "Nathan" },
        action: "account.created",
        summary: "Created the organisation",
        createdAt: "",
      },
    ],
    isLoading: false,
  }),
  useSopRevisions: () => ({ data: [], isLoading: false }),
  useAccount: (id: string | null) => ({
    data: id
      ? {
          account: {
            ...listItem(id, "Harbour Group"),
            overview: "",
            phone: null,
            email: null,
            website: null,
            address: null,
            createdAt: "",
            createdBy: null,
            updatedBy: null,
          },
          contacts: [
            {
              accountId: id,
              contactId: "ct_ana",
              role: "Owner",
              department: null,
              isPrimary: true,
              notes: null,
              createdAt: "",
              contact: { id: "ct_ana", displayName: "Ana Acme" },
            },
          ],
          alerts: mockState.alerts,
          sops: mockState.sops,
          notes: [],
          resources: [],
        }
      : undefined,
    isLoading: false,
    isError: false,
  }),
  // Calls through, then reports success the way react-query would.
  useAccountMutation: (fn: (args: unknown) => Promise<unknown>) => ({
    isPending: false,
    mutate: (
      args: unknown,
      opts?: {
        onSuccess?: (r: unknown) => void;
        onError?: (e: unknown) => void;
      },
    ) =>
      fn(args).then(
        (r) => opts?.onSuccess?.(r),
        (e) => opts?.onError?.(e),
      ),
  }),
}));

import { PeoplePicker } from "../src/components/PeoplePicker";
import { ContactOrganisations } from "../src/components/ContactOrganisations";
import { NewOrganisationScreen, OrganisationScreen } from "../src/components/OrganisationScreen";

const flush = () => act(async () => {});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  mockState.linked = [];
  mockState.accounts = [listItem("acc_abc", "ABC Magazines")];
  mockState.role = "admin";
  mockState.sops = [];
  mockState.alerts = [];
});

describe("PeoplePicker", () => {
  it("lists customers, leaving out the excluded and the blocked", () => {
    const view = render(<PeoplePicker selected={[]} onChange={() => {}} exclude={["ct_cat"]} />);
    expect(view.queryByText("Ana Acme")).not.toBeNull();
    expect(view.queryByText("Ben Bloom")).not.toBeNull();
    expect(view.queryByText("Cat Coast")).toBeNull();
    expect(view.queryByText("Spam Bot")).toBeNull();
  });

  it("ticks and unticks", () => {
    const onChange = jest.fn();
    const view = render(<PeoplePicker selected={["ct_ana"]} onChange={onChange} />);
    fireEvent.press(view.getByLabelText("Ben Bloom"));
    expect(onChange).toHaveBeenLastCalledWith(["ct_ana", "ct_ben"]);
    fireEvent.press(view.getByLabelText("Ana Acme"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("searches", () => {
    const view = render(<PeoplePicker selected={[]} onChange={() => {}} />);
    fireEvent.changeText(view.getByLabelText("Search customers"), "bloom");
    expect(view.queryByText("Ben Bloom")).not.toBeNull();
    expect(view.queryByText("Ana Acme")).toBeNull();
  });
});

describe("a customer's organisations", () => {
  it("adds them to an existing organisation", async () => {
    const view = render(<ContactOrganisations contactId="ct_ana" />);
    expect(view.queryByText("Not in an organisation yet.")).not.toBeNull();
    fireEvent.press(view.getByText("Add to an organisation"));
    fireEvent.press(view.getByLabelText("Add to ABC Magazines"));
    await flush();
    expect(mockApi.linkAccountContact).toHaveBeenCalledWith("acc_abc", {
      contactId: "ct_ana",
    });
  });

  it("creates a new organisation with them in it", async () => {
    const view = render(<ContactOrganisations contactId="ct_ana" />);
    fireEvent.press(view.getByText("Add to an organisation"));
    fireEvent.changeText(view.getByLabelText("Search organisations"), "Coastline Couriers");
    fireEvent.press(view.getByText("Create “Coastline Couriers”"));
    await flush();
    expect(mockApi.createAccount).toHaveBeenCalledWith({
      name: "Coastline Couriers",
      contactId: "ct_ana",
    });
  });

  it("offers the existing one when the name is taken", async () => {
    mockApi.createAccount.mockRejectedValueOnce(
      Object.assign(new Error("An organisation called ABC Magazines Ltd already exists"), {
        status: 409,
        body: {
          details: {
            existing: {
              id: "acc_abc",
              name: "ABC Magazines Ltd",
              archived: false,
            },
          },
        },
      }),
    );
    const view = render(<ContactOrganisations contactId="ct_ana" />);
    fireEvent.press(view.getByText("Add to an organisation"));
    fireEvent.changeText(view.getByLabelText("Search organisations"), "A.B.C. Magazines Limited");
    fireEvent.press(view.getByText("Create “A.B.C. Magazines Limited”"));
    await flush();
    fireEvent.press(view.getByText("Add to ABC Magazines Ltd"));
    await flush();
    expect(mockApi.linkAccountContact).toHaveBeenCalledWith("acc_abc", {
      contactId: "ct_ana",
    });
  });

  it("removes them after asking", async () => {
    mockState.linked = [
      {
        account: listItem("acc_abc", "ABC Magazines"),
        link: {
          accountId: "acc_abc",
          contactId: "ct_ana",
          role: "Owner",
          department: null,
          isPrimary: true,
          notes: null,
          createdAt: "",
        },
      },
    ];
    const alert = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === "destructive")?.onPress?.();
    });
    const view = render(<ContactOrganisations contactId="ct_ana" />);
    expect(view.queryByText("Owner · Primary")).not.toBeNull();
    fireEvent.press(view.getByLabelText("Remove from ABC Magazines"));
    await flush();
    expect(alert).toHaveBeenCalled();
    expect(mockApi.unlinkAccountContact).toHaveBeenCalledWith("acc_abc", "ct_ana");
    alert.mockRestore();
  });
});

describe("from the organisation's side", () => {
  it("creates an organisation with the people ticked", async () => {
    const onCreated = jest.fn();
    const view = render(<NewOrganisationScreen visible onClose={() => {}} onCreated={onCreated} />);
    fireEvent.changeText(view.getByLabelText("Name"), "Harbour Group");
    fireEvent.changeText(view.getByLabelText("Account reference (optional)"), "HG-1");
    fireEvent.press(view.getByLabelText("Ana Acme"));
    fireEvent.press(view.getByLabelText("Ben Bloom"));
    fireEvent.press(view.getByText("Create"));
    await flush();
    expect(mockApi.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Harbour Group",
        reference: "HG-1",
        contactIds: ["ct_ana", "ct_ben"],
        force: false,
      }),
    );
    expect(onCreated).toHaveBeenCalledWith("acc_new");
  });

  const screen = () => render(<OrganisationScreen id="acc_hg" onClose={() => {}} onOpenContact={() => {}} />);

  it("adds several people at once", async () => {
    const view = screen();
    fireEvent.press(view.getByRole("tab", { name: /People/ }));
    fireEvent.press(view.getByLabelText("Add people"));
    // Already there, so not offered again.
    expect(view.queryByRole("checkbox", { name: "Ana Acme" })).toBeNull();
    fireEvent.press(view.getByLabelText("Ben Bloom"));
    fireEvent.press(view.getByLabelText("Cat Coast"));
    fireEvent.press(view.getByText("Add 2"));
    await flush();
    expect(mockApi.linkAccountContacts).toHaveBeenCalledWith("acc_hg", {
      contactIds: ["ct_ben", "ct_cat"],
    });
  });

  it("edits a person's role", async () => {
    const view = screen();
    fireEvent.press(view.getByRole("tab", { name: /People/ }));
    fireEvent.press(view.getByLabelText("Edit Ana Acme's role"));
    fireEvent.changeText(view.getByLabelText("Role"), "Operations Director");
    fireEvent.press(view.getByText("Save"));
    await flush();
    expect(mockApi.updateAccountContact).toHaveBeenCalledWith(
      "acc_hg",
      "ct_ana",
      expect.objectContaining({ role: "Operations Director", isPrimary: true }),
    );
  });

  it("edits the organisation's details", async () => {
    const view = screen();
    fireEvent.press(view.getByLabelText("Edit organisation"));
    fireEvent.changeText(view.getByLabelText("Overview (optional)"), "Sends a magazine run every Thursday.");
    fireEvent.press(view.getByRole("radio", { name: "Prospect" }));
    fireEvent.press(view.getByText("Save"));
    await flush();
    expect(mockApi.updateAccount).toHaveBeenCalledWith(
      "acc_hg",
      expect.objectContaining({
        overview: "Sends a magazine run every Thursday.",
        status: "prospect",
      }),
    );
  });

  it("pins an instruction", async () => {
    const view = screen();
    fireEvent.press(view.getByLabelText("Add"));
    fireEvent.changeText(view.getByLabelText("Instruction"), "Only approved couriers.");
    fireEvent.press(view.getByRole("radio", { name: "Critical" }));
    fireEvent.press(view.getByText("Save"));
    await flush();
    expect(mockApi.createAccountAlert).toHaveBeenCalledWith("acc_hg", {
      body: "Only approved couriers.",
      priority: "critical",
    });
  });

  it("writes an SOP with ordered steps", async () => {
    const view = screen();
    fireEvent.press(view.getByRole("tab", { name: /Knowledge/ }));
    fireEvent.press(view.getByLabelText("New SOP"));
    fireEvent.changeText(view.getByLabelText("Title"), "Weekly run");
    fireEvent.changeText(view.getByLabelText("Step 1"), "Confirm the drop list");
    fireEvent.press(view.getByText("Add step"));
    fireEvent.changeText(view.getByLabelText("Step 2"), "Assign an approved courier");
    fireEvent.press(view.getAllByLabelText("Move up")[1]!);
    fireEvent.changeText(
      view.getByLabelText("Detailed instructions (optional)"),
      "Collect from Unit 4.\n\n- Never split the pallet",
    );
    fireEvent.press(view.getByRole("radio", { name: "Draft" }));
    fireEvent.press(view.getByText("Add"));
    await flush();
    expect(mockApi.createAccountSop).toHaveBeenCalledWith(
      "acc_hg",
      expect.objectContaining({
        title: "Weekly run",
        steps: [{ text: "Assign an approved courier" }, { text: "Confirm the drop list" }],
        body: "<p>Collect from Unit 4.</p><ul><li>Never split the pallet</li></ul>",
        status: "draft",
      }),
    );
  });

  it("adds a customer note and a link", async () => {
    const view = screen();
    fireEvent.press(view.getByRole("tab", { name: /Knowledge/ }));
    fireEvent.press(view.getByLabelText("Add note"));
    fireEvent.changeText(view.getByLabelText("Note"), "Prefers WhatsApp");
    fireEvent.press(view.getByText("Save"));
    await flush();
    expect(mockApi.createAccountNote).toHaveBeenCalledWith(
      "acc_hg",
      expect.objectContaining({ body: "<p>Prefers WhatsApp</p>" }),
    );

    fireEvent.press(view.getByRole("tab", { name: /Resources/ }));
    fireEvent.press(view.getByLabelText("Add"));
    fireEvent.changeText(view.getByLabelText("Web address"), "portal.example.com");
    fireEvent.changeText(view.getByLabelText("Name"), "Booking portal");
    fireEvent.press(view.getByText("Save"));
    await flush();
    expect(mockApi.createAccountResource).toHaveBeenCalledWith(
      "acc_hg",
      expect.objectContaining({
        kind: "link",
        title: "Booking portal",
        url: "https://portal.example.com",
      }),
    );
  });

  it("lets a manager delete it, after asking", async () => {
    const onClose = jest.fn();
    // Pick "Delete…" from the menu, then confirm.
    const alert = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === "destructive")?.onPress?.();
    });
    const view = render(<OrganisationScreen id="acc_hg" onClose={onClose} onOpenContact={() => {}} />);
    fireEvent.press(view.getByLabelText("Archive or delete"));
    await flush();
    expect(alert).toHaveBeenCalledTimes(2);
    expect(mockApi.deleteAccount).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    alert.mockRestore();
  });

  it("doesn't offer an agent archive or delete", () => {
    mockState.role = "agent";
    const view = screen();
    expect(view.queryByLabelText("Archive or delete")).toBeNull();
    expect(view.queryByLabelText("Edit organisation")).not.toBeNull();
  });
});

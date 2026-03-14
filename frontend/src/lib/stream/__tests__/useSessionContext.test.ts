import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionContext } from "../useSessionContext";

// --- Mock factories ---

function makeMockChannel(
  overrides: {
    id?: string;
    messages?: Array<{ created_at: string }>;
    frozenAt?: string | null;
  } = {},
) {
  const {
    id = "chat_org1_abcd1234",
    messages = [],
    frozenAt = null,
  } = overrides;
  return {
    id,
    data: { frozenAt },
    state: { messages },
    watch: vi.fn().mockResolvedValue(undefined),
    updatePartial: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockClient(
  overrides: {
    channelReturn?: ReturnType<typeof makeMockChannel>;
    queryChannelsReturn?: ReturnType<typeof makeMockChannel>[];
    userID?: string;
  } = {},
) {
  const channel =
    overrides.channelReturn ?? makeMockChannel();
  return {
    channel: vi.fn().mockReturnValue(channel),
    queryChannels: vi
      .fn()
      .mockResolvedValue(overrides.queryChannelsReturn ?? []),
    userID: overrides.userID ?? "test-user-001",
  };
}

// --- Test suites ---

let mockClient: ReturnType<typeof makeMockClient> | null = null;

vi.mock("../useStreamClient", () => ({
  useStreamClient: () => mockClient,
}));

// Mock crypto.subtle.digest for deterministic session hashes
const MOCK_HASH = "a1b2c3d4";
vi.stubGlobal("crypto", {
  ...globalThis.crypto,
  subtle: {
    ...globalThis.crypto?.subtle,
    digest: vi.fn().mockResolvedValue(
      // Return a buffer whose first 4 bytes encode "a1b2c3d4" in hex
      new Uint8Array([0xa1, 0xb2, 0xc3, 0xd4, 0x00, 0x00, 0x00, 0x00]).buffer,
    ),
  },
  randomUUID: () => "00000000-0000-0000-0000-000000000001",
});

describe("useSessionContext", () => {
  beforeEach(() => {
    mockClient = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- No-client cases ---

  it("returns null channel when Stream client is not ready", () => {
    const { result } = renderHook(() => useSessionContext("project-1", "org-1"));

    expect(result.current.currentChannel).toBeNull();
    expect(result.current.isFrozen).toBe(false);
  });

  it("createSession throws when client is not ready", async () => {
    const { result } = renderHook(() => useSessionContext("project-1", "org-1"));

    await expect(result.current.createSession("project-1")).rejects.toThrow(
      "Stream client not ready",
    );
  });

  it("switchSession throws when client is not ready", async () => {
    const { result } = renderHook(() => useSessionContext("project-1", "org-1"));

    await expect(result.current.switchSession("channel-1")).rejects.toThrow(
      "Stream client not ready",
    );
  });

  it("returns non-frozen state when no channel", () => {
    const { result } = renderHook(() => useSessionContext(null));

    expect(result.current.currentChannel).toBeNull();
    expect(result.current.isFrozen).toBe(false);
  });

  // --- Happy-path: channel creation ---

  it("createSession creates a channel with chat_{compactOrgId}_{hash} ID format", async () => {
    const channel = makeMockChannel({ id: `chat_org1_${MOCK_HASH}` });
    mockClient = makeMockClient({ channelReturn: channel });

    const { result } = renderHook(() => useSessionContext(null, "org-1"));

    let created: unknown;
    await act(async () => {
      created = await result.current.createSession("p1");
    });

    expect(mockClient.channel).toHaveBeenCalledWith(
      "messaging",
      expect.stringMatching(/^chat_org1_[0-9a-f]{8}$/),
      expect.objectContaining({
        projectId: "p1",
        orgId: "org-1",
        frozenAt: null,
      }),
    );
    expect(channel.watch).toHaveBeenCalled();
    expect(created).toBe(channel);
    expect(result.current.currentChannel).toBe(channel);
    expect(result.current.isFrozen).toBe(false);
  });

  it("channel ID stays under 64 chars for UUID org IDs", async () => {
    const uuidOrgId = "019ce9c7-0d01-7031-b95b-bcef2a97ddb4";
    const channel = makeMockChannel();
    mockClient = makeMockClient({ channelReturn: channel });

    const { result } = renderHook(() => useSessionContext(null, uuidOrgId));

    await act(async () => {
      await result.current.createSession("019ce9c7-0d01-7031-b95b-bcef2a97ddb4");
    });

    const channelIdArg = mockClient.channel.mock.calls[0][1] as string;
    expect(channelIdArg.length).toBeLessThanOrEqual(64);
    // chat_ (5) + 32 hex + _ (1) + 8 hex = 46
    expect(channelIdArg).toMatch(/^chat_[0-9a-f]{32}_[0-9a-f]{8}$/);
  });

  it("falls back to 'no-org' when orgId is null", async () => {
    const channel = makeMockChannel();
    mockClient = makeMockClient({ channelReturn: channel });

    const { result } = renderHook(() => useSessionContext(null, null));

    await act(async () => {
      await result.current.createSession("p1");
    });

    expect(mockClient.channel).toHaveBeenCalledWith(
      "messaging",
      expect.stringMatching(/^chat_noorg_[0-9a-f]{8}$/),
      expect.objectContaining({
        orgId: "no-org",
      }),
    );
  });

  // --- Freeze detection ---

  it("detects frozen channel when last message is older than 24 hours", async () => {
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const channel = makeMockChannel({
      id: "ch-old",
      messages: [{ created_at: staleTime }],
    });
    mockClient = makeMockClient({ channelReturn: channel });

    const { result } = renderHook(() => useSessionContext(null));

    await act(async () => {
      await result.current.switchSession("ch-old");
    });

    expect(channel.updatePartial).toHaveBeenCalledWith({
      set: { frozenAt: expect.any(String) },
    });
    expect(result.current.isFrozen).toBe(true);
    expect(result.current.currentChannel).toBe(channel);
  });

  it("does not freeze channel when last message is within 24 hours", async () => {
    const recentTime = new Date(Date.now() - 1000).toISOString();
    const channel = makeMockChannel({
      id: "ch-recent",
      messages: [{ created_at: recentTime }],
    });
    mockClient = makeMockClient({ channelReturn: channel });

    const { result } = renderHook(() => useSessionContext(null));

    await act(async () => {
      await result.current.switchSession("ch-recent");
    });

    expect(channel.updatePartial).not.toHaveBeenCalled();
    expect(result.current.isFrozen).toBe(false);
    expect(result.current.currentChannel).toBe(channel);
  });

  it("recognizes already-frozen channel without calling updatePartial again", async () => {
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const channel = makeMockChannel({
      id: "ch-already-frozen",
      messages: [{ created_at: staleTime }],
      frozenAt: "2025-01-01T00:00:00.000Z",
    });
    mockClient = makeMockClient({ channelReturn: channel });

    const { result } = renderHook(() => useSessionContext(null));

    await act(async () => {
      await result.current.switchSession("ch-already-frozen");
    });

    expect(channel.updatePartial).not.toHaveBeenCalled();
    expect(result.current.isFrozen).toBe(true);
  });

  // --- switchSession ---

  it("switchSession watches channel and sets it as current", async () => {
    const channel = makeMockChannel({ id: "ch-switch" });
    mockClient = makeMockClient({ channelReturn: channel });

    const { result } = renderHook(() => useSessionContext(null));

    await act(async () => {
      await result.current.switchSession("ch-switch");
    });

    expect(mockClient.channel).toHaveBeenCalledWith("messaging", "ch-switch");
    expect(channel.watch).toHaveBeenCalled();
    expect(result.current.currentChannel).toBe(channel);
  });

  // --- Auto-init effect ---

  it("auto-creates session when project loads with no existing channels", async () => {
    const channel = makeMockChannel();
    mockClient = makeMockClient({
      channelReturn: channel,
      queryChannelsReturn: [],
    });

    renderHook(() => useSessionContext("p1", "org-1"));

    await waitFor(() => {
      expect(mockClient.queryChannels).toHaveBeenCalledWith(
        { type: "messaging", "custom.projectId": "p1" },
        [{ last_message_at: -1 }],
        { limit: 10 },
      );
      // Should have created a new session with compact format
      expect(mockClient.channel).toHaveBeenCalledWith(
        "messaging",
        expect.stringMatching(/^chat_org1_[0-9a-f]{8}$/),
        expect.objectContaining({ projectId: "p1", orgId: "org-1" }),
      );
      expect(channel.watch).toHaveBeenCalled();
    });
  });

  it("auto-selects existing active channel on init", async () => {
    const recentTime = new Date(Date.now() - 1000).toISOString();
    const existingChannel = makeMockChannel({
      id: "project_p1_existing",
      messages: [{ created_at: recentTime }],
    });
    mockClient = makeMockClient({
      queryChannelsReturn: [existingChannel as never],
    });

    renderHook(() => useSessionContext("p1", "org-1"));

    await waitFor(() => {
      // Should NOT have created a new channel
      expect(mockClient.channel).not.toHaveBeenCalledWith(
        "messaging",
        expect.stringMatching(/^chat_/),
        expect.anything(),
      );
      expect(existingChannel.updatePartial).not.toHaveBeenCalled();
    });
  });

  it("auto-creates new session when all existing channels are frozen", async () => {
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const frozenChannel = makeMockChannel({
      id: "project_p1_old",
      messages: [{ created_at: staleTime }],
      frozenAt: "2025-01-01T00:00:00.000Z",
    });
    const newChannel = makeMockChannel({ id: "chat_org1_new" });
    mockClient = makeMockClient({
      channelReturn: newChannel,
      queryChannelsReturn: [frozenChannel as never],
    });

    renderHook(() => useSessionContext("p1", "org-1"));

    await waitFor(() => {
      // Should have created a new channel since the existing one is frozen
      expect(mockClient.channel).toHaveBeenCalledWith(
        "messaging",
        expect.stringMatching(/^chat_org1_[0-9a-f]{8}$/),
        expect.objectContaining({ projectId: "p1", orgId: "org-1" }),
      );
    });
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionContext } from "../useSessionContext";

// --- Mock factories ---

function makeMockChannel(
  overrides: {
    id?: string;
    messages?: Array<{ created_at: string }>;
  } = {},
) {
  const { id = "chat_org1_abcd1234", messages = [] } = overrides;
  return {
    id,
    data: { orgId: "org-1", projectId: null, datasetId: null, title: null },
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
  const channel = overrides.channelReturn ?? makeMockChannel();
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
    const { result } = renderHook(() => useSessionContext("org-1"));
    expect(result.current.currentChannel).toBeNull();
  });

  it("createSession throws when client is not ready", async () => {
    const { result } = renderHook(() => useSessionContext("org-1"));
    await expect(result.current.createSession("org-1")).rejects.toThrow(
      "Stream client not ready",
    );
  });

  it("resumeSession throws when client is not ready", async () => {
    const { result } = renderHook(() => useSessionContext("org-1"));
    await expect(result.current.resumeSession("channel-1")).rejects.toThrow(
      "Stream client not ready",
    );
  });

  // --- Channel creation ---

  it("createSession creates a channel with chat_{compactOrgId}_{hash} ID format", async () => {
    const channel = makeMockChannel({ id: `chat_org1_${MOCK_HASH}` });
    mockClient = makeMockClient({ channelReturn: channel });

    const { result } = renderHook(() => useSessionContext("org-1"));

    let created: unknown;
    await act(async () => {
      created = await result.current.createSession("org-1");
    });

    expect(mockClient.channel).toHaveBeenCalledWith(
      "messaging",
      expect.stringMatching(/^chat_org1_[0-9a-f]{8}$/),
      expect.objectContaining({
        orgId: "org-1",
        projectId: null,
        datasetId: null,
        title: null,
      }),
    );
    expect(channel.watch).toHaveBeenCalled();
    expect(created).toBe(channel);
    expect(result.current.currentChannel).toBe(channel);
  });

  it("channel ID stays under 64 chars for UUID org IDs", async () => {
    const uuidOrgId = "019ce9c7-0d01-7031-b95b-bcef2a97ddb4";
    const channel = makeMockChannel();
    mockClient = makeMockClient({ channelReturn: channel });

    const { result } = renderHook(() => useSessionContext(uuidOrgId));

    await act(async () => {
      await result.current.createSession(uuidOrgId);
    });

    const channelIdArg = mockClient.channel.mock.calls[0][1] as string;
    expect(channelIdArg.length).toBeLessThanOrEqual(64);
    expect(channelIdArg).toMatch(/^chat_[0-9a-f]{32}_[0-9a-f]{8}$/);
  });

  // --- Resume session ---

  it("resumeSession watches channel and sets it as current", async () => {
    const channel = makeMockChannel({ id: "ch-resume" });
    mockClient = makeMockClient({ channelReturn: channel });

    const { result } = renderHook(() => useSessionContext("org-1"));

    await act(async () => {
      await result.current.resumeSession("ch-resume");
    });

    expect(mockClient.channel).toHaveBeenCalledWith("messaging", "ch-resume");
    expect(channel.watch).toHaveBeenCalled();
    expect(result.current.currentChannel).toBe(channel);
  });

  // --- Query channels ---

  it("queryChannels filters by org ID", async () => {
    const channels = [makeMockChannel()];
    mockClient = makeMockClient({ queryChannelsReturn: channels as never[] });

    const { result } = renderHook(() => useSessionContext("org-1"));

    let queried: unknown;
    await act(async () => {
      queried = await result.current.queryChannels("org-1");
    });

    expect(mockClient.queryChannels).toHaveBeenCalledWith(
      { type: "messaging", "custom.orgId": "org-1" },
      [{ last_message_at: -1 }],
      { limit: 30 },
    );
    expect(queried).toEqual(channels);
  });

  it("queryChannels respects custom limit", async () => {
    mockClient = makeMockClient({ queryChannelsReturn: [] });

    const { result } = renderHook(() => useSessionContext("org-1"));

    await act(async () => {
      await result.current.queryChannels("org-1", 5);
    });

    expect(mockClient.queryChannels).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { limit: 5 },
    );
  });
});

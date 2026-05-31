import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "@/dataCatalog";

// MR-6 — UploadModal: a standalone upload surface detached from the assistant.
// browse/drop → cosmetic 3-leg dial-up progress over the EXISTING single-step
// uploadFile('/api/uploads') → schema view from the returned schema_config →
// editable display name persisted via updateDataset (filename/name untouched) →
// "upload another to same schema" / "create source" → source-node reopen via
// existingSource. The dataCatalog clients are doubled at the boundary (DWD-M6-11);
// happy-dom asserts structure/values/navigation, never colors or dial-up timing.

const { mockUploadFile, mockUpdateDataset } = vi.hoisted(() => ({
  mockUploadFile: vi.fn(),
  mockUpdateDataset: vi.fn(),
}));

vi.mock("@/auth", () => ({
  withAuth: (f: typeof fetch) => f,
}));

vi.mock("@/dataCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/dataCatalog")>();
  return {
    ...actual,
    createDataCatalog: () => ({
      uploadFile: mockUploadFile,
      updateDataset: mockUpdateDataset,
    }),
  };
});

import { UploadModal, type UploadModalProps } from "./UploadModal";

function makeDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "ds-9",
    project_id: "p-1",
    name: "orders.csv",
    description: null,
    schema_config: {
      fields: {
        order_id: { label: "Order ID", type: "number" },
        status: { label: "Status", type: "text" },
      },
    },
    partition_fields: [],
    transforms: [],
    preview_rows: [],
    column_profiles: null,
    display_name: null,
    ...overrides,
  };
}

function renderModal(props: Partial<UploadModalProps> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const merged: UploadModalProps = {
    open: true,
    projectId: "p-1",
    onClose: vi.fn(),
    onSourceCreated: vi.fn(),
    ...props,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...render(<UploadModal {...merged} />, { wrapper }), props: merged };
}

function selectFile(name = "orders.csv") {
  const input = screen.getByTestId("upload-file-input");
  const file = new File(["order_id,status\n1,active"], name, {
    type: "text/csv",
  });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe("UploadModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    renderModal({ open: false });
    expect(screen.queryByTestId("upload-modal")).not.toBeInTheDocument();
  });

  it("opens as an accessible dialog with a browse affordance", () => {
    renderModal();
    const dialog = screen.getByTestId("upload-modal");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("upload-browse-button")).toBeInTheDocument();
    expect(screen.getByTestId("upload-file-input")).toBeInTheDocument();
  });

  it("shows the cosmetic 3-leg dial-up progress while the upload is in flight", async () => {
    let resolveUpload!: (d: Dataset) => void;
    mockUploadFile.mockImplementation(
      () => new Promise<Dataset>((res) => (resolveUpload = res)),
    );
    renderModal();

    await act(async () => {
      selectFile();
    });

    expect(screen.getByTestId("upload-progress")).toBeInTheDocument();
    expect(screen.getByTestId("upload-leg-0")).toBeInTheDocument();
    expect(screen.getByTestId("upload-leg-1")).toBeInTheDocument();
    expect(screen.getByTestId("upload-leg-2")).toBeInTheDocument();

    await act(async () => {
      resolveUpload(makeDataset());
    });
  });

  it("renders the parsed schema view after the upload resolves", async () => {
    mockUploadFile.mockResolvedValue(makeDataset());
    renderModal();

    selectFile();

    expect(await screen.findByTestId("upload-schema-field-order_id")).toBeInTheDocument();
    expect(screen.getByTestId("upload-schema-field-status")).toBeInTheDocument();
  });

  it("@walking_skeleton uploads a file, edits the display name, and creates a source — display_name persisted, filename/name unchanged", async () => {
    mockUploadFile.mockResolvedValue(makeDataset({ id: "ds-9", name: "orders.csv", display_name: null }));
    mockUpdateDataset.mockResolvedValue(makeDataset({ id: "ds-9", display_name: "Q1 Orders" }));
    const { props } = renderModal();

    const file = selectFile();

    // The display-name input falls back to the raw name when display_name is null.
    const nameInput = await screen.findByTestId("display-name-input");
    expect(nameInput).toHaveValue("orders.csv");

    fireEvent.change(nameInput, { target: { value: "Q1 Orders" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("display-name-save"));
    });

    // Persisted ONLY the display name — the underlying filename/name is never sent.
    await waitFor(() => expect(mockUpdateDataset).toHaveBeenCalledTimes(1));
    expect(mockUpdateDataset.mock.calls[0][0]).toBe("ds-9");
    expect(mockUpdateDataset.mock.calls[0][1]).toEqual({ display_name: "Q1 Orders" });

    // The upload itself went to the existing single-step endpoint with the project id.
    expect(mockUploadFile).toHaveBeenCalledWith("/api/uploads", file, {
      project_id: "p-1",
    });

    // Creating the source hands the dataset to the host (it becomes a lineage node) and closes.
    fireEvent.click(screen.getByTestId("upload-create-source"));
    expect(props.onSourceCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ds-9" }),
    );
    expect(props.onClose).toHaveBeenCalled();
  });

  it("re-uploads to the same schema with the dataset id on 'upload another'", async () => {
    mockUploadFile.mockResolvedValue(makeDataset({ id: "ds-9" }));
    renderModal();

    selectFile("orders.csv");
    await screen.findByTestId("upload-create-source");

    fireEvent.click(screen.getByTestId("upload-another"));

    const second = selectFile("more-orders.csv");
    await waitFor(() =>
      expect(mockUploadFile).toHaveBeenLastCalledWith("/api/uploads", second, {
        project_id: "p-1",
        dataset_id: "ds-9",
      }),
    );
  });

  it("shows a retry affordance when the upload fails", async () => {
    mockUploadFile.mockRejectedValue(new Error("upload failed"));
    renderModal();

    selectFile();

    expect(await screen.findByTestId("upload-error")).toBeInTheDocument();
    expect(screen.getByTestId("upload-retry")).toBeInTheDocument();
  });

  it("renders the per-source file-history empty-state (deferred c — not served today)", async () => {
    mockUploadFile.mockResolvedValue(makeDataset());
    renderModal();

    selectFile();

    expect(await screen.findByTestId("upload-history-empty")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.keyDown(screen.getByTestId("upload-modal"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on the close button", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByTestId("upload-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("reopens directly into an existing source (schema + prefilled display name, no browse)", () => {
    renderModal({
      existingSource: makeDataset({
        id: "ds-5",
        name: "legacy.csv",
        display_name: "Legacy Orders",
      }),
    });

    expect(screen.getByTestId("upload-schema-field-order_id")).toBeInTheDocument();
    expect(screen.getByTestId("display-name-input")).toHaveValue("Legacy Orders");
    expect(screen.queryByTestId("upload-browse-button")).not.toBeInTheDocument();
  });
});

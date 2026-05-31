// UploadModalArchive — the snowflake "move to cold storage" action (MR-7). RED until DELIVER 07-03.
//
// The existing-source step (reopened from a source node) grows a snowflake archive button →
// a ConfirmDialog → confirm fires the archive mutation (catalog.archiveDataset, doubled at the
// boundary) and closes the modal; cancel dismisses the dialog WITHOUT archiving. Mirrors the
// MR-6 UploadModal.test doubling pattern; the existing UploadModal.test.tsx is untouched.
// happy-dom asserts structure/values (DWD-M7-2).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "@/dataCatalog";

const { mockUploadFile, mockUpdateDataset, mockArchiveDataset } = vi.hoisted(() => ({
  mockUploadFile: vi.fn(),
  mockUpdateDataset: vi.fn(),
  mockArchiveDataset: vi.fn(),
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
      archiveDataset: mockArchiveDataset,
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
    schema_config: { fields: { order_id: { label: "Order ID", type: "number" } } },
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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const merged: UploadModalProps = {
    open: true,
    projectId: "p-1",
    onClose: vi.fn(),
    onSourceCreated: vi.fn(),
    existingSource: makeDataset(),
    ...props,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const utils = render(<UploadModal {...merged} />, { wrapper });
  return { ...utils, props: merged };
}

describe("UploadModal — snowflake archive (cold storage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockArchiveDataset.mockResolvedValue(makeDataset({ archived_at: "2026-06-01T00:00:00Z" }));
  });

  it("shows a snowflake archive button on the existing-source step", () => {
    renderModal();
    expect(screen.getByTestId("archive-source-button")).toBeInTheDocument();
  });

  it("opens a confirm dialog before archiving (no archive until confirmed)", () => {
    renderModal();

    fireEvent.click(screen.getByTestId("archive-source-button"));

    expect(screen.getByTestId("archive-confirm-dialog")).toBeInTheDocument();
    expect(mockArchiveDataset).not.toHaveBeenCalled();
  });

  it("archives the source and closes the modal when confirmed", async () => {
    const { props } = renderModal();

    fireEvent.click(screen.getByTestId("archive-source-button"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("archive-confirm"));
    });

    await waitFor(() => {
      expect(mockArchiveDataset).toHaveBeenCalledWith("ds-9");
    });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("does NOT archive when the confirm dialog is cancelled", () => {
    renderModal();

    fireEvent.click(screen.getByTestId("archive-source-button"));
    fireEvent.click(screen.getByTestId("archive-cancel"));

    expect(screen.queryByTestId("archive-confirm-dialog")).not.toBeInTheDocument();
    expect(mockArchiveDataset).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import type { Dataset } from "@/dataCatalog";

import { UploadWidget } from "../../../lib/ui/components/ChatPanel/UploadWidget";

const { mockUploadFile } = vi.hoisted(() => ({
  mockUploadFile: vi.fn(),
}));

// Mock the dataCatalog factory to return a catalog with a mock uploadFile
vi.mock("@/dataCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/dataCatalog")>();
  return {
    ...actual,
    createDataCatalog: () => ({
      uploadFile: mockUploadFile,
    }),
  };
});

// Mock @/auth to avoid real auth
vi.mock("@/auth", () => ({
  withAuth: (fn: typeof fetch) => fn,
}));

const mockDataset: Dataset = {
  id: "d-1",
  project_id: "p-1",
  name: "New Dataset",
  description: null,
  schema_config: { fields: {} },
  partition_fields: [],
  transforms: [],
  preview_rows: [],
  column_profiles: null,
};

function createFile(name = "test.csv"): File {
  return new File(["col1,col2\na,b"], name, { type: "text/csv" });
}

describe("UploadWidget", () => {
  beforeEach(() => {
    mockUploadFile.mockReset();
  });

  it("renders Browse button in initial state", () => {
    render(
      <UploadWidget
        projectId="p-1"
        onUploadComplete={vi.fn()}
        autoOpen={false}
      />,
    );
    expect(screen.getByRole("button", { name: /browse/i })).toBeInTheDocument();
  });

  it("shows filename and Send button after file selection", async () => {
    render(
      <UploadWidget
        projectId="p-1"
        onUploadComplete={vi.fn()}
        autoOpen={false}
      />,
    );
    const input = screen.getByTestId("upload-file-input") as HTMLInputElement;
    const file = createFile("data.csv");

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText("data.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("removes file and resets to Browse when X is clicked", async () => {
    render(
      <UploadWidget
        projectId="p-1"
        onUploadComplete={vi.fn()}
        autoOpen={false}
      />,
    );
    const input = screen.getByTestId("upload-file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createFile()] } });

    fireEvent.click(screen.getByRole("button", { name: /remove file/i }));

    expect(screen.getByRole("button", { name: /browse/i })).toBeInTheDocument();
    expect(screen.queryByText("test.csv")).not.toBeInTheDocument();
  });

  it("calls API and onUploadComplete on successful upload", async () => {
    mockUploadFile.mockResolvedValueOnce(mockDataset);
    const onComplete = vi.fn();

    render(
      <UploadWidget
        projectId="p-1"
        onUploadComplete={onComplete}
        autoOpen={false}
      />,
    );
    const input = screen.getByTestId("upload-file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /uploaded/i })).toBeDisabled();
    });

    expect(mockUploadFile).toHaveBeenCalledWith(
      "/api/uploads",
      expect.any(File),
      {
        project_id: "p-1",
      },
    );
    expect(onComplete).toHaveBeenCalledWith(mockDataset);
  });

  it("shows error and calls onUploadError on failure", async () => {
    mockUploadFile.mockRejectedValueOnce(
      new Error("Only CSV files are supported"),
    );
    const onError = vi.fn();

    render(
      <UploadWidget
        projectId="p-1"
        onUploadComplete={vi.fn()}
        onUploadError={onError}
        autoOpen={false}
      />,
    );
    const input = screen.getByTestId("upload-file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Only CSV files are supported"),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith("Only CSV files are supported");
  });

  it("retry resets to Browse state", async () => {
    mockUploadFile.mockRejectedValueOnce(new Error("fail"));

    render(
      <UploadWidget
        projectId="p-1"
        onUploadComplete={vi.fn()}
        autoOpen={false}
      />,
    );
    const input = screen.getByTestId("upload-file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [createFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /retry/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(screen.getByRole("button", { name: /browse/i })).toBeInTheDocument();
  });
});

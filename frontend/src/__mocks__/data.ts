import type { Project, DatasetSparse } from "@/api";
import type { Dataset, SchemaConfig, Transform } from "@/api";

const SAMPLE_SCHEMA_CONFIG: SchemaConfig = {
  fields: {
    id: { label: "ID", type: "text" },
    name: { label: "Name", type: "text" },
    category: { label: "Category", type: "select" },
    amount: { label: "Amount", type: "number" },
    quantity: { label: "Quantity", type: "number" },
    inStock: { label: "In Stock", type: "boolean" },
  },
};

export function createMockSchemaConfig(overrides?: Partial<SchemaConfig>): SchemaConfig {
  return { ...SAMPLE_SCHEMA_CONFIG, ...overrides };
}

export function createMockDatasetSparse(overrides?: Partial<DatasetSparse>): DatasetSparse {
  return {
    id: "ds-001",
    name: "Sales Data",
    link: "/api/datasets/ds-001",
    description: "Monthly sales records",
    row_count: 1500,
    schema_config: createMockSchemaConfig(),
    ...overrides,
  };
}

export function createMockTransform(overrides?: Partial<Transform>): Transform {
  return {
    id: "tf-001",
    name: "Filter active items",
    description: "Only show items currently in stock",
    condition_json: { id: "root", type: "group", properties: { conjunction: "AND" }, children1: {} },
    condition_sql: "inStock = true",
    status: "enabled",
    ...overrides,
  };
}

export function createMockDataset(overrides?: Partial<Dataset>): Dataset {
  return {
    id: "ds-001",
    project_id: "proj-001",
    name: "Sales Data",
    description: "Monthly sales records",
    schema_config: createMockSchemaConfig(),
    partition_fields: [],
    transforms: [createMockTransform()],
    preview_rows: [
      { id: "1", name: "Widget A", category: "Electronics", amount: 29.99, quantity: 150, inStock: true },
      { id: "2", name: "Widget B", category: "Electronics", amount: 49.99, quantity: 75, inStock: true },
    ],
    ...overrides,
  };
}

export function createMockProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-001",
    name: "Inventory Dashboard",
    description: "Product inventory tracking",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-06-15T12:00:00Z",
    datasets: MOCK_DATASETS,
    ...overrides,
  };
}

export const MOCK_DATASETS: DatasetSparse[] = [
  createMockDatasetSparse({ id: "ds-001", name: "Sales Data", description: "Monthly sales records", row_count: 1500 }),
  createMockDatasetSparse({ id: "ds-002", name: "Inventory", description: "Current stock levels", row_count: 850 }),
  createMockDatasetSparse({ id: "ds-003", name: "Returns", description: "Product return history", row_count: 320 }),
];

export const MOCK_PROJECT: Project = createMockProject();

export const MOCK_DATASET_FULL: Dataset = createMockDataset();

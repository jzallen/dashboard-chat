import { ColumnDef } from "@tanstack/react-table";
import type { TableRow } from "@/table-tools";
import type { TableSchema } from "../types";

export const initialData: TableRow[] = [
  {
    id: "1",
    name: "Widget A",
    category: "Electronics",
    amount: 29.99,
    quantity: 150,
    inStock: true,
  },
  {
    id: "2",
    name: "Widget B",
    category: "Electronics",
    amount: 49.99,
    quantity: 75,
    inStock: true,
  },
  {
    id: "3",
    name: "Gadget X",
    category: "Accessories",
    amount: 15.0,
    quantity: 200,
    inStock: true,
  },
  {
    id: "4",
    name: "Gadget Y",
    category: "Accessories",
    amount: 8.5,
    quantity: 0,
    inStock: false,
  },
  {
    id: "5",
    name: "Tool Alpha",
    category: "Hardware",
    amount: 125.0,
    quantity: 30,
    inStock: true,
  },
  {
    id: "6",
    name: "Tool Beta",
    category: "Hardware",
    amount: 89.99,
    quantity: 45,
    inStock: true,
  },
  {
    id: "7",
    name: "Part 101",
    category: "Components",
    amount: 2.5,
    quantity: 500,
    inStock: true,
  },
  {
    id: "8",
    name: "Part 102",
    category: "Components",
    amount: 3.75,
    quantity: 0,
    inStock: false,
  },
  {
    id: "9",
    name: "Device Pro",
    category: "Electronics",
    amount: 299.99,
    quantity: 12,
    inStock: true,
  },
  {
    id: "10",
    name: "Device Lite",
    category: "Electronics",
    amount: 149.99,
    quantity: 0,
    inStock: false,
  },
];

export const columns: ColumnDef<TableRow>[] = [
  { accessorKey: "id", header: "ID" },
  { accessorKey: "name", header: "Name" },
  { accessorKey: "category", header: "Category" },
  {
    accessorKey: "amount",
    header: "Amount",
    cell: ({ getValue }) => `$${(getValue() as number).toFixed(2)}`,
  },
  { accessorKey: "quantity", header: "Quantity" },
  {
    accessorKey: "inStock",
    header: "In Stock",
    cell: ({ getValue }) => (getValue() ? "✓" : "✗"),
  },
];

export const tableSchema: TableSchema = {
  columns: [
    { id: "id", type: "string" },
    { id: "name", type: "string" },
    { id: "category", type: "string" },
    { id: "amount", type: "number" },
    { id: "quantity", type: "number" },
    { id: "inStock", type: "boolean" },
  ],
  rowCount: initialData.length,
};

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

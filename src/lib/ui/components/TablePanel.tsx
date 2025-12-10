import type { Dispatch, SetStateAction } from "react";
import { flexRender, type Table, type ColumnFiltersState } from "@tanstack/react-table";
import type { TableRow } from "../../table-tools";
import { ActiveFilters } from "./ActiveFilters";
import { Pagination } from "./Pagination";
import { columns } from "../data/sampleData";

interface TablePanelProps {
  table: Table<TableRow>;
  columnFilters: ColumnFiltersState;
  setColumnFilters: Dispatch<SetStateAction<ColumnFiltersState>>;
  totalRows: number;
}

export function TablePanel({
  table,
  columnFilters,
  setColumnFilters,
  totalRows,
}: TablePanelProps) {
  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-800">Quill Table Demo</h1>
        <p className="text-gray-600 text-sm mt-1">
          Chat with the AI to filter, sort, add, or delete rows
        </p>
      </div>

      <ActiveFilters
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
      />

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:bg-gray-100"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                      {{ asc: " ↑", desc: " ↓" }[
                        header.column.getIsSorted() as string
                      ] ?? null}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="hover:bg-gray-50">
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-6 py-8 text-center text-gray-500"
                >
                  No matching rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination table={table} totalRows={totalRows} />
    </div>
  );
}

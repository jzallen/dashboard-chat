import type { Table } from "@tanstack/react-table";
import type { TableRow } from "../../table-tools";

interface PaginationProps {
  table: Table<TableRow>;
  totalRows: number;
}

export function Pagination({ table, totalRows }: PaginationProps) {
  return (
    <div className="flex items-center justify-between mt-4">
      <div className="text-sm text-gray-600">
        Showing {table.getRowModel().rows.length} of {totalRows} rows
      </div>
      <div className="flex items-center gap-2">
        <button
          className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </button>
        <span className="text-sm text-gray-600">
          Page {table.getState().pagination.pageIndex + 1} of{" "}
          {table.getPageCount() || 1}
        </span>
        <button
          className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next
        </button>
      </div>
    </div>
  );
}

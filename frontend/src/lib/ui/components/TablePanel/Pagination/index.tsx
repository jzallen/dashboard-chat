import type { Table } from "@tanstack/react-table";

import type { TableRow } from "@/table-tools";

import { PageButton } from "./PageButton";
import { PageIndicator } from "./PageIndicator";
import styles from "./Pagination.module.css";
import { RowCount } from "./RowCount";

interface PaginationProps {
  table: Table<TableRow>;
  totalRows: number;
}

export default function Pagination({ table, totalRows }: PaginationProps) {
  const currentPage = table.getState().pagination.pageIndex + 1;
  const totalPages = table.getPageCount() || 1;
  const visibleCount = table.getRowModel().rows.length;

  return (
    <div className={styles.container}>
      <RowCount visibleCount={visibleCount} totalCount={totalRows} />
      <div className={styles.controls}>
        <PageButton
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </PageButton>
        <PageIndicator currentPage={currentPage} totalPages={totalPages} />
        <PageButton
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next
        </PageButton>
      </div>
    </div>
  );
}

import type { ColumnFiltersState,Table } from "@tanstack/react-table";
import type { Dispatch, SetStateAction } from "react";

import type { TableRow } from "@/table-tools";

import ActiveFilters from "./ActiveFilters";
import Pagination from "./Pagination";
import { TableBody } from "./TableBody";
import { TableHead } from "./TableHead";
import styles from "./TablePanel.module.css";

interface TablePanelProps {
  table: Table<TableRow>;
  columnFilters: ColumnFiltersState;
  setColumnFilters: Dispatch<SetStateAction<ColumnFiltersState>>;
  totalRows: number;
  onToggleTransform?: (transformId: string, isActive: boolean) => void;
}

export default function TablePanel({
  table,
  columnFilters,
  setColumnFilters,
  totalRows,
  onToggleTransform,
}: TablePanelProps) {
  return (
    <div className={styles.panel}>
      <ActiveFilters
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        onToggleTransform={onToggleTransform}
      />

      <div className={styles.tableContainer}>
        <table data-testid="data-table" className={styles.table}>
          <TableHead headerGroups={table.getHeaderGroups()} />
          <TableBody
            rows={table.getRowModel().rows}
            columnCount={table.getAllColumns().length}
          />
        </table>
      </div>

      <Pagination table={table} totalRows={totalRows} />
    </div>
  );
}

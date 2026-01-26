import type { Dispatch, SetStateAction } from "react";
import type { Table, ColumnFiltersState } from "@tanstack/react-table";
import type { TableRow } from "@/table-tools";
import ActiveFilters from "./ActiveFilters";
import Pagination from "./Pagination";
import { TableHeader } from "./TableHeader";
import { TableHead } from "./TableHead";
import { TableBody } from "./TableBody";
import { columns } from "../../data/sampleData";
import styles from "./TablePanel.module.css";

interface TablePanelProps {
  table: Table<TableRow>;
  columnFilters: ColumnFiltersState;
  setColumnFilters: Dispatch<SetStateAction<ColumnFiltersState>>;
  totalRows: number;
  projectName?: string;
  datasetName?: string;
  onSettingsClick?: () => void;
}

export default function TablePanel({
  table,
  columnFilters,
  setColumnFilters,
  totalRows,
  projectName,
  datasetName,
  onSettingsClick,
}: TablePanelProps) {
  return (
    <div className={styles.panel}>
      <TableHeader
        projectName={projectName}
        datasetName={datasetName}
        onSettingsClick={onSettingsClick}
      />

      <ActiveFilters
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
      />

      <div className={styles.tableContainer}>
        <table data-testid="data-table" className={styles.table}>
          <TableHead headerGroups={table.getHeaderGroups()} />
          <TableBody
            rows={table.getRowModel().rows}
            columnCount={columns.length}
          />
        </table>
      </div>

      <Pagination table={table} totalRows={totalRows} />
    </div>
  );
}

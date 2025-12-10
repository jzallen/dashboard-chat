import { flexRender, type Row } from "@tanstack/react-table";
import type { TableRow } from "../../../table-tools";
import styles from "./TablePanel.module.css";

interface TableBodyProps {
  rows: Row<TableRow>[];
  columnCount: number;
}

export function TableBody({ rows, columnCount }: TableBodyProps) {
  return (
    <tbody className={styles.tbody}>
      {rows.map((row) => (
        <tr key={row.id} className={styles.tr}>
          {row.getVisibleCells().map((cell) => (
            <td key={cell.id} className={styles.td}>
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </td>
          ))}
        </tr>
      ))}
      {rows.length === 0 && (
        <tr>
          <td colSpan={columnCount} className={styles.emptyRow}>
            No matching rows
          </td>
        </tr>
      )}
    </tbody>
  );
}

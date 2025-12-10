import { flexRender, type HeaderGroup } from "@tanstack/react-table";
import type { TableRow } from "../../../table-tools";
import styles from "./TablePanel.module.css";

interface TableHeadProps {
  headerGroups: HeaderGroup<TableRow>[];
}

export function TableHead({ headerGroups }: TableHeadProps) {
  return (
    <thead className={styles.thead}>
      {headerGroups.map((headerGroup) => (
        <tr key={headerGroup.id}>
          {headerGroup.headers.map((header) => (
            <th
              key={header.id}
              className={styles.th}
              onClick={header.column.getToggleSortingHandler()}
            >
              <div className={styles.thContent}>
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
  );
}

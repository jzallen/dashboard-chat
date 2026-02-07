export function customFilterFn(
  row: { getValue: (columnId: string) => unknown },
  columnId: string,
  filterValue: { operator: string; value: unknown }
): boolean {
  const cellValue = row.getValue(columnId);
  const { operator, value } = filterValue;

  switch (operator) {
    case "equals":
      return (
        cellValue === value ||
        String(cellValue).toLowerCase() === String(value).toLowerCase()
      );
    case "notEquals":
      return (
        cellValue !== value &&
        String(cellValue).toLowerCase() !== String(value).toLowerCase()
      );
    case "contains":
      return String(cellValue)
        .toLowerCase()
        .includes(String(value).toLowerCase());
    case "gt":
      return Number(cellValue) > Number(value);
    case "lt":
      return Number(cellValue) < Number(value);
    case "gte":
      return Number(cellValue) >= Number(value);
    case "lte":
      return Number(cellValue) <= Number(value);
    default:
      return true;
  }
}

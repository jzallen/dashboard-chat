import { isCompoundFilter, type TanStackFilterValue } from "@/raqb";

function evaluateCondition(
  cellValue: unknown,
  condition: { operator: string; value: unknown }
): boolean {
  const { operator, value } = condition;
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
      console.warn(`customFilterFn: unknown operator "${operator}"`);
      return false;
  }
}

export function customFilterFn(
  row: { getValue: (columnId: string) => unknown },
  columnId: string,
  filterValue: TanStackFilterValue
): boolean {
  const cellValue = row.getValue(columnId);

  if (isCompoundFilter(filterValue)) {
    return filterValue.conditions.every((condition) =>
      evaluateCondition(cellValue, condition)
    );
  }

  return evaluateCondition(cellValue, filterValue);
}

import { isCompoundFilter, type TanStackFilterValue } from "@/raqb";

/** Evaluates a single filter condition against a cell value using the specified operator. */
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

/** TanStack Table filter function that supports compound filters (multiple conditions ANDed together). */
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

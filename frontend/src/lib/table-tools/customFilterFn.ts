interface FilterCondition {
  operator: string;
  value: unknown;
}

interface CompoundFilterValue {
  conditions: FilterCondition[];
}

type FilterValue = FilterCondition | CompoundFilterValue;

function isCompound(value: FilterValue): value is CompoundFilterValue {
  return 'conditions' in value;
}

function evaluateCondition(
  cellValue: unknown,
  { operator, value }: FilterCondition
): boolean {
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

export function customFilterFn(
  row: { getValue: (columnId: string) => unknown },
  columnId: string,
  filterValue: FilterValue
): boolean {
  const cellValue = row.getValue(columnId);

  // Compound filter: all conditions must pass (AND)
  if (isCompound(filterValue)) {
    return filterValue.conditions.every((condition) =>
      evaluateCondition(cellValue, condition)
    );
  }

  // Single filter (backward compat)
  return evaluateCondition(cellValue, filterValue);
}

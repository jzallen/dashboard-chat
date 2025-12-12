import { Page } from "@playwright/test";

export class TableHelper {
  constructor(private page: Page) {}

  async waitForTable(): Promise<void> {
    await this.page.waitForSelector('[data-testid="data-table"]');
  }

  static async create(page: Page): Promise<TableHelper> {
    const helper = new TableHelper(page);
    await helper.waitForTable();
    return helper;
  }

  get table() {
    return this.page.getByTestId("data-table");
  }

  get headerRow() {
    return this.page.getByTestId("table-header-row");
  }

  get bodyRows() {
    return this.page.locator('[data-testid^="table-row-"]');
  }

  get emptyStateRow() {
    return this.page.getByTestId("table-empty-state");
  }

  async getVisibleRowCount(): Promise<number> {
    await this.page.waitForTimeout(300);
    return await this.bodyRows.count();
  }

  async getColumnValues(columnIndex: number): Promise<string[]> {
    const rows = this.bodyRows;
    const count = await rows.count();
    const values: string[] = [];

    for (let i = 0; i < count; i++) {
      const cell = rows.nth(i).locator("td").nth(columnIndex);
      const text = await cell.textContent();
      values.push(text?.trim() || "");
    }

    return values;
  }

  async getColumnIndex(headerName: string): Promise<number> {
    const headers = this.headerRow.locator("th");
    const count = await headers.count();

    for (let i = 0; i < count; i++) {
      const text = await headers.nth(i).textContent();
      if (text?.toLowerCase().includes(headerName.toLowerCase())) {
        return i;
      }
    }
    throw new Error(`Column "${headerName}" not found`);
  }

  async isColumnSorted(
    columnName: string,
    direction: "asc" | "desc"
  ): Promise<boolean> {
    const index = await this.getColumnIndex(columnName);
    const values = await this.getColumnValues(index);

    if (values.length < 2) return true;

    const numericValues = values.map((v) => {
      const cleaned = v.replace(/[$,]/g, "");
      return parseFloat(cleaned);
    });

    const allNumeric = numericValues.every((n) => !isNaN(n));

    if (allNumeric) {
      for (let i = 1; i < numericValues.length; i++) {
        if (direction === "asc" && numericValues[i] < numericValues[i - 1])
          return false;
        if (direction === "desc" && numericValues[i] > numericValues[i - 1])
          return false;
      }
    } else {
      for (let i = 1; i < values.length; i++) {
        const compare = values[i].localeCompare(values[i - 1]);
        if (direction === "asc" && compare < 0) return false;
        if (direction === "desc" && compare > 0) return false;
      }
    }

    return true;
  }

  async allRowsMatchFilter(
    columnName: string,
    operator: "gt" | "lt" | "gte" | "lte" | "equals" | "contains",
    value: number | string
  ): Promise<boolean> {
    const index = await this.getColumnIndex(columnName);
    const values = await this.getColumnValues(index);

    return values.every((cellValue) => {
      const numValue = parseFloat(cellValue.replace(/[$,]/g, ""));

      switch (operator) {
        case "gt":
          return numValue > (value as number);
        case "lt":
          return numValue < (value as number);
        case "gte":
          return numValue >= (value as number);
        case "lte":
          return numValue <= (value as number);
        case "equals":
          return cellValue === String(value) || numValue === value;
        case "contains":
          return cellValue.toLowerCase().includes(String(value).toLowerCase());
        default:
          return false;
      }
    });
  }

  async rowExists(partialMatch: Record<string, string | number>): Promise<boolean> {
    const rows = this.bodyRows;
    const count = await rows.count();

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      let matches = true;

      for (const [columnName, expectedValue] of Object.entries(partialMatch)) {
        const colIndex = await this.getColumnIndex(columnName);
        const cell = row.locator("td").nth(colIndex);
        const cellText = (await cell.textContent())?.trim() || "";

        const cleanCell = cellText.replace(/[$,]/g, "");
        const cleanExpected = String(expectedValue).replace(/[$,]/g, "");

        if (cleanCell !== cleanExpected && !cellText.includes(String(expectedValue))) {
          matches = false;
          break;
        }
      }

      if (matches) return true;
    }

    return false;
  }

  getInitialRowCount(): number {
    return 10;
  }

  async hasRecordMatching(partial: Partial<Record<string, string>>): Promise<boolean> {
    const records = await this.tableToRecords();
    return records.some((r) =>
      Object.entries(partial).every(([key, value]) => r[key] === value)
    );
  }

  async recordAtIndex(record: Record<string, string>, index: number): Promise<boolean> {
    const records = await this.tableToRecords();
    if (index < 0 || index >= records.length) return false;
    return JSON.stringify(records[index]) === JSON.stringify(record);
  }

  async tableToRecords(): Promise<Record<string, string>[]> {
    const headers = this.headerRow.locator("th");
    const headerCount = await headers.count();
    const columnNames: string[] = [];

    for (let i = 0; i < headerCount; i++) {
      const text = await headers.nth(i).textContent();
      // Strip sort indicators (↑ ↓) from header names
      const cleanName = text?.trim().replace(/\s*[↑↓]$/, "") || `column_${i}`;
      columnNames.push(cleanName);
    }

    const rows = this.bodyRows;
    const rowCount = await rows.count();
    const records: Record<string, string>[] = [];

    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const cells = row.locator("td");
      const record: Record<string, string> = {};

      for (let j = 0; j < columnNames.length; j++) {
        const cell = cells.nth(j);
        const text = await cell.textContent();
        record[columnNames[j]] = text?.trim() || "";
      }

      records.push(record);
    }

    return records;
  }
}

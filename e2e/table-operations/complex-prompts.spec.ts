import { test, expect } from "../fixtures/test-fixtures";

test.describe("Complex Prompts", () => {
  test.beforeEach(async ({ tableHelper }) => {
    await tableHelper.table.page().goto("/");
    await expect(tableHelper.table).toBeVisible();
  });

  test("should handle 2 filters, 2 sorts, row addition, and row deletion in a single prompt", async ({
    chatHelper,
    tableHelper,
  }) => {
    // Inventory cleanup scenario: add new arrival, remove discontinued item,
    // then filter out-of-stock and low-value items, sort by category to review pricing
    await chatHelper.sendMessageAndWaitForToolExecution(
      'Add a new product called "Gadget Z" in Accessories category with amount 22.50 and quantity 50 and inStock true, ' +
        "delete the row for Tool Beta, " +
        "then show me in-stock items with amount greater than 5, " +
        "and sort by category ascending then amount descending"
    );

    // Expected results after all operations:
    // - Filtered: inStock=true AND amount>5 (removes Gadget Y, Part 101, Part 102, Device Lite)
    // - Added: Gadget Z (Accessories, $22.50)
    // - Deleted: Tool Beta
    // - Sorted: Category ASC, then Amount DESC
    const expectedRecords = [
      { Name: "Gadget Z", Category: "Accessories", Amount: "$22.50", Quantity: "50", "In Stock": "✓" },
      { Name: "Gadget X", Category: "Accessories", Amount: "$15.00", Quantity: "200", "In Stock": "✓" },
      { Name: "Device Pro", Category: "Electronics", Amount: "$299.99", Quantity: "12", "In Stock": "✓" },
      { Name: "Widget B", Category: "Electronics", Amount: "$49.99", Quantity: "75", "In Stock": "✓" },
      { Name: "Widget A", Category: "Electronics", Amount: "$29.99", Quantity: "150", "In Stock": "✓" },
      { Name: "Tool Alpha", Category: "Hardware", Amount: "$125.00", Quantity: "30", "In Stock": "✓" },
    ];

    const records = await tableHelper.getPageRecords();

    // Compare records excluding ID (new row has generated ID)
    const recordsWithoutId = records.map(({ ID, ...rest }) => rest);
    expect(recordsWithoutId).toEqual(expectedRecords);
  });

  /**
   * Tests multilingual prompt support via Spanish language input.
   *
   * Note: This capability is a side-effect of using an LLM to interpret user prompts,
   * not an inherent feature of the application itself. The app does not have built-in
   * internationalization - the LLM simply understands and processes Spanish naturally.
   */
  test("should handle complex prompt in Spanish", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      "Muéstrame los artículos en stock con monto mayor a 5, " +
        "ordena por categoría ascendente y luego por monto descendente, " +
        'agrega un nuevo producto llamado "Gadget Z" en la categoría Accessories con monto 22.50 y cantidad 50 y inStock true, ' +
        "y elimina la fila de Tool Beta"
    );

    const expectedRecords = [
      { Name: "Gadget Z", Category: "Accessories", Amount: "$22.50", Quantity: "50", "In Stock": "✓" },
      { Name: "Gadget X", Category: "Accessories", Amount: "$15.00", Quantity: "200", "In Stock": "✓" },
      { Name: "Device Pro", Category: "Electronics", Amount: "$299.99", Quantity: "12", "In Stock": "✓" },
      { Name: "Widget B", Category: "Electronics", Amount: "$49.99", Quantity: "75", "In Stock": "✓" },
      { Name: "Widget A", Category: "Electronics", Amount: "$29.99", Quantity: "150", "In Stock": "✓" },
      { Name: "Tool Alpha", Category: "Hardware", Amount: "$125.00", Quantity: "30", "In Stock": "✓" },
    ];

    const records = await tableHelper.getPageRecords();

    const recordsWithoutId = records.map(({ ID, ...rest }) => rest);
    expect(recordsWithoutId).toEqual(expectedRecords);
  });
});

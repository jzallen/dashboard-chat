// Frontend - Quill Take Home Project
// React + TanStack Table + Chat UI with SSE streaming

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  ColumnFiltersState,
} from "@tanstack/react-table";
import {
  executeToolCall as executeToolCallFn,
  customFilterFn,
  type ToolCall,
  type TableRow,
} from "./src/lib/executeToolCall";

// ============================================================================
// Types
// ============================================================================

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls?: ToolCall[];
  isStreaming?: boolean;
}

interface TableSchema {
  columns: Array<{ id: string; type: "string" | "number" | "boolean" }>;
  rowCount: number;
}

interface SSEMessage {
  type: "content" | "tool_calls" | "done" | "error";
  content?: string;
  tool_calls?: ToolCall[];
  error?: string;
}

// ============================================================================
// Sample Data
// ============================================================================

const initialData: TableRow[] = [
  {
    id: "1",
    name: "Widget A",
    category: "Electronics",
    amount: 29.99,
    quantity: 150,
    inStock: true,
  },
  {
    id: "2",
    name: "Widget B",
    category: "Electronics",
    amount: 49.99,
    quantity: 75,
    inStock: true,
  },
  {
    id: "3",
    name: "Gadget X",
    category: "Accessories",
    amount: 15.0,
    quantity: 200,
    inStock: true,
  },
  {
    id: "4",
    name: "Gadget Y",
    category: "Accessories",
    amount: 8.5,
    quantity: 0,
    inStock: false,
  },
  {
    id: "5",
    name: "Tool Alpha",
    category: "Hardware",
    amount: 125.0,
    quantity: 30,
    inStock: true,
  },
  {
    id: "6",
    name: "Tool Beta",
    category: "Hardware",
    amount: 89.99,
    quantity: 45,
    inStock: true,
  },
  {
    id: "7",
    name: "Part 101",
    category: "Components",
    amount: 2.5,
    quantity: 500,
    inStock: true,
  },
  {
    id: "8",
    name: "Part 102",
    category: "Components",
    amount: 3.75,
    quantity: 0,
    inStock: false,
  },
  {
    id: "9",
    name: "Device Pro",
    category: "Electronics",
    amount: 299.99,
    quantity: 12,
    inStock: true,
  },
  {
    id: "10",
    name: "Device Lite",
    category: "Electronics",
    amount: 149.99,
    quantity: 0,
    inStock: false,
  },
];

const columns: ColumnDef<TableRow>[] = [
  { accessorKey: "id", header: "ID" },
  { accessorKey: "name", header: "Name" },
  { accessorKey: "category", header: "Category" },
  {
    accessorKey: "amount",
    header: "Amount",
    cell: ({ getValue }) => `$${(getValue() as number).toFixed(2)}`,
  },
  { accessorKey: "quantity", header: "Quantity" },
  {
    accessorKey: "inStock",
    header: "In Stock",
    cell: ({ getValue }) => (getValue() ? "✓" : "✗"),
  },
];

const tableSchema: TableSchema = {
  columns: [
    { id: "id", type: "string" },
    { id: "name", type: "string" },
    { id: "category", type: "string" },
    { id: "amount", type: "number" },
    { id: "quantity", type: "number" },
    { id: "inStock", type: "boolean" },
  ],
  rowCount: initialData.length,
};

// ============================================================================
// API Configuration
// ============================================================================

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

// ============================================================================
// Main App Component
// ============================================================================

export default function App() {
  // Table state
  const [data, setData] = useState<TableRow[]>(initialData);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize table
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    filterFns: { custom: customFilterFn },
    defaultColumn: { filterFn: customFilterFn },
  });

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ============================================================================
  // Tool Execution
  // ============================================================================

  const executeToolCall = useCallback(
    (toolCall: ToolCall): string => {
      return executeToolCallFn(toolCall, {
        setColumnFilters,
        setSorting,
        setData,
      });
    },
    [setColumnFilters, setSorting, setData]
  );

  // ============================================================================
  // Chat Submission
  // ============================================================================

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: String(Date.now()),
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Create assistant message placeholder
    const assistantId = String(Date.now() + 1);
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        isStreaming: true,
      },
    ]);

    try {
      // Build message history for API
      const apiMessages = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls,
      }));

      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          tableSchema: { ...tableSchema, rowCount: data.length },
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error("No response body");

      // Process SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedContent = "";
      let toolCalls: ToolCall[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const data: SSEMessage = JSON.parse(jsonStr);

            switch (data.type) {
              case "content":
                if (data.content) {
                  accumulatedContent += data.content;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? { ...m, content: accumulatedContent }
                        : m
                    )
                  );
                }
                break;

              case "tool_calls":
                if (data.tool_calls) {
                  toolCalls = data.tool_calls;
                }
                break;

              case "error":
                throw new Error(data.error || "Stream error");

              case "done":
                // Execute tool calls
                if (toolCalls.length > 0) {
                  const results = toolCalls.map((tc) => executeToolCall(tc));
                  const toolSummary = results.join(", ");

                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? {
                            ...m,
                            content:
                              accumulatedContent || `Executed: ${toolSummary}`,
                            tool_calls: toolCalls,
                            isStreaming: false,
                          }
                        : m
                    )
                  );
                } else {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId ? { ...m, isStreaming: false } : m
                    )
                  );
                }
                break;
            }
          } catch (parseError) {
            console.error("Parse error:", parseError);
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: `Error: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
                isStreaming: false,
              }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Table Panel */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-800">Quill Table Demo</h1>
          <p className="text-gray-600 text-sm mt-1">
            Chat with the AI to filter, sort, add, or delete rows
          </p>
        </div>

        {/* Active Filters Display */}
        {columnFilters.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {columnFilters.map((filter) => {
              const filterVal = filter.value as {
                operator: string;
                value: unknown;
              };
              return (
                <span
                  key={filter.id}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                >
                  {filter.id} {filterVal.operator} {String(filterVal.value)}
                  <button
                    onClick={() =>
                      setColumnFilters((prev) =>
                        prev.filter((f) => f.id !== filter.id)
                      )
                    }
                    className="ml-1 hover:text-blue-600"
                  >
                    ×
                  </button>
                </span>
              );
            })}
            <button
              onClick={() => setColumnFilters([])}
              className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:bg-gray-100"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1">
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
            <tbody className="bg-white divide-y divide-gray-200">
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {table.getRowModel().rows.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-6 py-8 text-center text-gray-500"
                  >
                    No matching rows
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-gray-600">
            Showing {table.getRowModel().rows.length} of {data.length} rows
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </button>
            <span className="text-sm text-gray-600">
              Page {table.getState().pagination.pageIndex + 1} of{" "}
              {table.getPageCount() || 1}
            </span>
            <button
              className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Chat Panel */}
      <div className="w-96 border-l border-gray-200 flex flex-col bg-white">
        <div className="p-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-800">Chat</h2>
          <p className="text-xs text-gray-500 mt-1">
            Try: "Show items with amount greater than 50"
          </p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-gray-500 mt-8">
              <p className="text-sm">
                Start a conversation to control the table
              </p>
              <div className="mt-4 space-y-2 text-xs text-left bg-gray-50 p-3 rounded">
                <p className="font-medium text-gray-700">Examples:</p>
                <p>"Filter by category Electronics"</p>
                <p>"Sort by amount descending"</p>
                <p>"Show items not in stock"</p>
                <p>"Add a new item called Test with amount 99"</p>
                <p>"Delete the first row"</p>
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  message.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                {message.tool_calls && message.tool_calls.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-600">
                    {message.tool_calls.map((tc) => (
                      <div key={tc.id} className="flex items-center gap-1">
                        <span className="text-green-600">✓</span>
                        <span>{tc.function.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {message.isStreaming && (
                  <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-1" />
                )}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a command..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700"
            >
              {isLoading ? "..." : "Send"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

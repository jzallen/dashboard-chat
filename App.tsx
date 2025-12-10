// Frontend - Quill Take Home Project
// React + TanStack Table + Chat UI with SSE streaming

import { useCallback } from "react";
import {
  useTableConfig,
  useChat,
  TablePanel,
  ChatPanel,
  tableSchema,
} from "./src/lib/ui";
import {
  executeToolCall as executeToolCallFn,
  type ToolCall,
} from "./src/lib/table-tools";

export default function App() {
  const {
    table,
    data,
    columnFilters,
    setColumnFilters,
    setSorting,
    setData,
  } = useTableConfig();

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

  const chat = useChat({
    executeToolCall,
    tableSchema: { ...tableSchema, rowCount: data.length },
  });

  return (
    <div className="flex h-screen bg-gray-50">
      <TablePanel
        table={table}
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        totalRows={data.length}
      />
      <ChatPanel {...chat} />
    </div>
  );
}

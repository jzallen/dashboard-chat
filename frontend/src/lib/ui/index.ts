// Types
export type { Message, TableSchema, SSEMessage } from "./types";

// Data
export { initialData, columns, tableSchema, API_URL, CHAT_URL } from "./data/sampleData";

// Hooks
export { useChat } from "./hooks/useChat";
export { useTableConfig } from "./hooks/useTableConfig";

// Context
export { ChatProvider, useChatContext } from "./context/ChatContext";
export type { ToolHandler } from "./context/ChatContext";

// Components
export { default as TablePanel } from "./components/TablePanel";
export { default as ChatPanel } from "./components/ChatPanel";
export { ProjectView } from "./components/DatasetView";
export { AppShell } from "./components/AppShell";
export { ProjectNav } from "./components/ProjectNav";

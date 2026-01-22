/**
 * PipelineList component for displaying saved filters
 */

import { useEffect } from "react";
import type { Pipeline } from "@/api";
import { PipelineCard } from "./PipelineCard";

interface PipelineListProps {
  pipelines: Pipeline[];
  loading: boolean;
  error: string | null;
  onApply: (pipeline: Pipeline) => void;
  onDelete: (pipelineId: string) => void;
  onRefresh: () => void;
}

export function PipelineList({
  pipelines,
  loading,
  error,
  onApply,
  onDelete,
  onRefresh,
}: PipelineListProps) {
  // Refresh on mount
  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  if (loading && pipelines.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        Loading saved filters...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-red-600 text-sm mb-2">{error}</div>
        <button
          onClick={onRefresh}
          className="text-blue-600 text-sm hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (pipelines.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        <p className="text-sm">No saved filters yet.</p>
        <p className="text-xs mt-1 text-gray-400">
          Use the chat to create complex filters, then save them for later.
        </p>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-2 max-h-96 overflow-y-auto">
      <div className="flex items-center justify-between px-2 py-1">
        <h2 className="text-sm font-semibold text-gray-700">Saved Filters</h2>
        <button
          onClick={onRefresh}
          className="text-xs text-gray-500 hover:text-gray-700"
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      {pipelines.map((pipeline) => (
        <PipelineCard
          key={pipeline.id}
          pipeline={pipeline}
          onApply={onApply}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

// Re-export components
export { PipelineCard } from "./PipelineCard";

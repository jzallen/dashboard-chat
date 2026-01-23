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
  onToggle: (pipelineId: string, isActive: boolean) => void;
  onRefresh: () => void;
}

export function PipelineList({
  pipelines,
  loading,
  error,
  onApply,
  onToggle,
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

  // Separate active and inactive pipelines
  const activePipelines = pipelines.filter((p) => p.is_active);
  const inactivePipelines = pipelines.filter((p) => !p.is_active);

  return (
    <div className="p-6 space-y-6">
      {/* Active Filters Section */}
      {activePipelines.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            Active Filters ({activePipelines.length})
          </h3>
          <div className="space-y-2">
            {activePipelines.map((pipeline) => (
              <PipelineCard
                key={pipeline.id}
                pipeline={pipeline}
                onApply={onApply}
                onToggle={onToggle}
              />
            ))}
          </div>
        </div>
      )}

      {/* Inactive Filters Section */}
      {inactivePipelines.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
            Inactive Filters ({inactivePipelines.length})
          </h3>
          <div className="space-y-2">
            {inactivePipelines.map((pipeline) => (
              <PipelineCard
                key={pipeline.id}
                pipeline={pipeline}
                onApply={onApply}
                onToggle={onToggle}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Re-export components
export { PipelineCard } from "./PipelineCard";

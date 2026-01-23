/**
 * Filter Settings View Component
 */

import type { Pipeline } from "@/api";
import { PipelineList } from "../PipelineList";

interface FilterSettingsProps {
  pipelines: Pipeline[];
  loading: boolean;
  error: string | null;
  onApply: (pipeline: Pipeline) => void;
  onToggle: (pipelineId: string, isActive: boolean) => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function FilterSettings({
  pipelines,
  loading,
  error,
  onApply,
  onToggle,
  onRefresh,
  onClose,
}: FilterSettingsProps) {
  return (
    <div className="flex flex-col h-full bg-white">
      {/* Settings Header */}
      <div className="border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-800">Filter Settings</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage your saved filters - toggle them on or off
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            title="Back to table"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-6 h-6 text-gray-600"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
      {/* Filter List */}
      <div className="flex-1 overflow-y-auto">
        <PipelineList
          pipelines={pipelines}
          loading={loading}
          error={error}
          onApply={onApply}
          onToggle={onToggle}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  );
}

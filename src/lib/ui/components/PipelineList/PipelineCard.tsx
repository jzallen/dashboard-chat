/**
 * Pipeline card component for displaying a saved filter
 */

import type { Pipeline } from "@/api";
import { countRules } from "@/raqb";

interface PipelineCardProps {
  pipeline: Pipeline;
  onApply: (pipeline: Pipeline) => void;
  onToggle: (pipelineId: string, isActive: boolean) => void;
}

export function PipelineCard({ pipeline, onApply, onToggle }: PipelineCardProps) {
  const ruleCount = countRules(pipeline.raqb_json);
  const createdDate = new Date(pipeline.created_at).toLocaleDateString();

  return (
    <div className={`border rounded-lg p-4 transition-all ${
      pipeline.is_active
        ? "border-green-300 bg-green-50/30"
        : "border-gray-200 bg-white"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-gray-900">{pipeline.name}</h3>
            {pipeline.is_active && (
              <span className="px-2 py-0.5 text-xs font-medium text-green-700 bg-green-100 rounded-full">
                Active
              </span>
            )}
          </div>
          {pipeline.description && (
            <p className="text-sm text-gray-600 mt-1">
              {pipeline.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
            <span>{ruleCount} condition{ruleCount !== 1 ? "s" : ""}</span>
            <span>·</span>
            <span>v{pipeline.version}</span>
            <span>·</span>
            <span>{createdDate}</span>
          </div>
          {pipeline.cached_sql && (
            <div className="mt-2 px-2 py-1.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
              {pipeline.cached_sql}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* Toggle Switch */}
          <button
            onClick={() => onToggle(pipeline.id, !pipeline.is_active)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              pipeline.is_active
                ? "bg-green-600 focus:ring-green-500"
                : "bg-gray-300 focus:ring-gray-400"
            }`}
            title={pipeline.is_active ? "Deactivate this filter" : "Activate this filter"}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                pipeline.is_active ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

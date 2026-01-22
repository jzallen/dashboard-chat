/**
 * Pipeline card component for displaying a saved filter
 */

import type { Pipeline } from "@/api";
import { countRules } from "@/raqb";

interface PipelineCardProps {
  pipeline: Pipeline;
  onApply: (pipeline: Pipeline) => void;
  onDelete: (pipelineId: string) => void;
}

export function PipelineCard({ pipeline, onApply, onDelete }: PipelineCardProps) {
  const ruleCount = countRules(pipeline.raqb_json);
  const createdDate = new Date(pipeline.created_at).toLocaleDateString();

  return (
    <div className="border border-gray-200 rounded-lg p-3 hover:border-blue-300 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 truncate">{pipeline.name}</h3>
          {pipeline.description && (
            <p className="text-sm text-gray-500 truncate mt-0.5">
              {pipeline.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
            <span>{ruleCount} condition{ruleCount !== 1 ? "s" : ""}</span>
            <span>·</span>
            <span>v{pipeline.version}</span>
            <span>·</span>
            <span>{createdDate}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => onApply(pipeline)}
            className="px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title="Apply this filter"
          >
            Apply
          </button>
          <button
            onClick={() => onDelete(pipeline.id)}
            className="px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded transition-colors"
            title="Delete this filter"
          >
            Delete
          </button>
        </div>
      </div>
      {pipeline.nl_prompt && (
        <div className="mt-2 px-2 py-1 bg-gray-50 rounded text-xs text-gray-600 italic">
          "{pipeline.nl_prompt}"
        </div>
      )}
    </div>
  );
}

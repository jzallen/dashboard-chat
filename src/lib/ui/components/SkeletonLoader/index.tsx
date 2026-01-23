/**
 * Skeleton loader for table panel
 */

export function TablePanelSkeleton() {
  return (
    <div className="flex flex-col h-full bg-white animate-pulse">
      {/* Header skeleton */}
      <div className="border-b border-gray-200 p-4">
        <div className="h-6 bg-gray-200 rounded w-32"></div>
      </div>

      {/* Active filters skeleton */}
      <div className="border-b border-gray-200 p-3">
        <div className="flex gap-2">
          <div className="h-7 bg-gray-200 rounded-full w-32"></div>
          <div className="h-7 bg-gray-200 rounded-full w-40"></div>
        </div>
      </div>

      {/* Table skeleton */}
      <div className="flex-1 overflow-hidden p-4">
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          {/* Table header */}
          <div className="bg-gray-50 border-b border-gray-200">
            <div className="flex">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex-1 p-3">
                  <div className="h-4 bg-gray-300 rounded w-20"></div>
                </div>
              ))}
            </div>
          </div>

          {/* Table rows */}
          <div className="divide-y divide-gray-200">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((row) => (
              <div key={row} className="flex">
                {[1, 2, 3, 4, 5].map((col) => (
                  <div key={col} className="flex-1 p-3">
                    <div className="h-4 bg-gray-200 rounded w-full max-w-[120px]"></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pagination skeleton */}
      <div className="border-t border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="h-4 bg-gray-200 rounded w-32"></div>
          <div className="flex gap-2">
            <div className="h-8 bg-gray-200 rounded w-20"></div>
            <div className="h-8 bg-gray-200 rounded w-20"></div>
          </div>
          <div className="h-4 bg-gray-200 rounded w-24"></div>
        </div>
      </div>
    </div>
  );
}

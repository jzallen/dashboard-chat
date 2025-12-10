export function ChatEmptyState() {
  return (
    <div className="text-center text-gray-500 mt-8">
      <p className="text-sm">Start a conversation to control the table</p>
      <div className="mt-4 space-y-2 text-xs text-left bg-gray-50 p-3 rounded">
        <p className="font-medium text-gray-700">Examples:</p>
        <p>"Filter by category Electronics"</p>
        <p>"Sort by amount descending"</p>
        <p>"Show items not in stock"</p>
        <p>"Add a new item called Test with amount 99"</p>
        <p>"Delete the first row"</p>
      </div>
    </div>
  );
}

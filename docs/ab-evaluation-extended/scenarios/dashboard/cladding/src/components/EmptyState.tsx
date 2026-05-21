export function EmptyState() {
  return (
    <div className="border rounded p-8 text-center text-slate-500">
      <p className="font-medium">No data for the selected range</p>
      <p className="text-sm mt-1">Try a different time range.</p>
    </div>
  );
}

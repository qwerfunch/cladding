export function CardSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4">
      {Array.from({length: 4}).map((_, i) => (
        <div key={i} className="border rounded p-4 animate-pulse h-24 bg-slate-100 dark:bg-slate-800" />
      ))}
    </div>
  );
}

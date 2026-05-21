export interface ListCardProps {
  readonly title: string;
  readonly items: readonly {readonly path: string; readonly hits: number}[];
}

export function ListCard({title, items}: ListCardProps) {
  return (
    <div className="border rounded p-4 bg-white dark:bg-slate-800">
      <div className="text-sm font-medium mb-2">{title}</div>
      <ul className="text-sm space-y-1">
        {items.map((item) => (
          <li key={item.path} className="flex justify-between">
            <span className="truncate">{item.path}</span>
            <span className="text-slate-500">{item.hits.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

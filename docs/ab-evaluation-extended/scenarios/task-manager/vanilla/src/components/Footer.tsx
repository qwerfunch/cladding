export interface FooterProps {
  readonly visibleCount: number;
  readonly onImport: (json: string) => void;
}

export function Footer({visibleCount, onImport}: FooterProps) {
  return (
    <footer className="pt-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500">
      <span>{visibleCount} task(s) visible</span>
      <label className="cursor-pointer underline">
        Import JSON
        <input
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => onImport(String(reader.result ?? ''));
            reader.readAsText(file);
          }}
        />
      </label>
    </footer>
  );
}

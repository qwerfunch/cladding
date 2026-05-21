export interface FooterProps {
  readonly lastUpdated: number | null;
}

export function Footer({lastUpdated}: FooterProps) {
  return (
    <footer className="pt-4 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500">
      {lastUpdated ? `Last updated: ${new Date(lastUpdated).toLocaleString()}` : 'No data yet'}
    </footer>
  );
}

export interface SidebarProps {
  readonly section: string;
  readonly onSelect: (s: string) => void;
}

const SECTIONS = ['overview', 'users', 'revenue', 'health'] as const;

export function Sidebar({section, onSelect}: SidebarProps) {
  return (
    <nav className="w-40 shrink-0 border-r border-slate-200 dark:border-slate-700 pr-4">
      <ul className="space-y-1 text-sm">
        {SECTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onSelect(s)}
              className={`block w-full text-left px-2 py-1 rounded ${section === s ? 'bg-slate-200 dark:bg-slate-700' : ''}`}
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

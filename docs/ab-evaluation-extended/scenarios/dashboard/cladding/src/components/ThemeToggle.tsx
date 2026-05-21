import type {Theme} from '../hooks/useTheme';

export interface ThemeToggleProps {
  readonly theme: Theme;
  readonly onChange: (t: Theme) => void;
}

export function ThemeToggle({theme, onChange}: ThemeToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(theme === 'dark' ? 'light' : 'dark')}
      className="text-xs uppercase tracking-wider border rounded px-3 py-1"
    >
      {theme === 'dark' ? '☼ light' : '☾ dark'}
    </button>
  );
}

export interface BreadcrumbsProps {
  readonly section: string;
}

export function Breadcrumbs({section}: BreadcrumbsProps) {
  return (
    <nav className="text-xs text-slate-500" aria-label="breadcrumbs">
      Dashboard / <span className="capitalize">{section}</span>
    </nav>
  );
}

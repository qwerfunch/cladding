export interface ErrorStateProps {
  readonly message: string;
  readonly onRetry: () => void;
}

export function ErrorState({message, onRetry}: ErrorStateProps) {
  return (
    <div className="border rounded p-6 bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-200 text-center">
      <p className="font-medium">Failed to load data</p>
      <p className="text-sm mt-1">{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 underline text-sm">
        Retry
      </button>
    </div>
  );
}

export function SectionHeading({
  label,
  count,
  action,
}: {
  label: string;
  count?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-ink pb-1.5">
      <h2 className="eyebrow text-ink">{label}</h2>
      {count && <span className="font-mono text-xs text-ink-soft">{count}</span>}
      {action}
    </div>
  );
}

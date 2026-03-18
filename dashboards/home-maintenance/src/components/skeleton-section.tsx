export function SkeletonSection() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-4 w-24 rounded bg-bg-card-hover" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg bg-bg-card border border-border p-4">
          <div className="h-4 w-3/4 rounded bg-bg-card-hover" />
          <div className="mt-2 h-3 w-1/2 rounded bg-bg-card-hover" />
        </div>
      ))}
    </div>
  );
}

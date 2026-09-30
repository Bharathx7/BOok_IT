/** Grey placeholder block shown while content loads. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-slate-200/70 ${className}`} />;
}

/** Placeholder with the shape of a VenueCard. */
export function VenueCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="space-y-3 p-5">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-4 h-4 w-1/2" />
      </div>
    </div>
  );
}

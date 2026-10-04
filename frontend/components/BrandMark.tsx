/** ReliefTrigger mark: a seismograph trace that ends in a trigger point. */
export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} role="img" aria-label="ReliefTrigger">
      <rect width="32" height="32" rx="8" fill="#F97316" />
      <path
        d="M4 17h5l2-4 3 9 3-15 3 12 1.5-2H24"
        fill="none"
        stroke="#0B1320"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="26.5" cy="17" r="2.5" fill="#0B1320" />
    </svg>
  );
}

// Текстовый логотип F.R.I.D.A.Y.
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-[0.25em] ${className}`}>
      F.R.I.D.A.Y
    </span>
  );
}

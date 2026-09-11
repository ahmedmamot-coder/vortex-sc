// Inline SVG stopwatch glyph — matches the codebase convention of hand-rolled
// SVG (see pace-clock) rather than pulling a component from an icon library.

export default function StopwatchIcon({
  size = 20,
  color = "currentColor",
  className,
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* crown button */}
      <line x1="10" y1="2" x2="14" y2="2" />
      <line x1="12" y1="2" x2="12" y2="4" />
      {/* start/stop side button */}
      <line x1="18.5" y1="4.5" x2="20" y2="6" />
      {/* body */}
      <circle cx="12" cy="14" r="8" />
      {/* hand pointing to ~2 o'clock */}
      <line x1="12" y1="14" x2="16" y2="11" />
    </svg>
  );
}

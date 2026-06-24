import './brand-mark.css';

type BrandMarkProps = {
  className?: string;
};

export function BrandMark({ className = '' }: BrandMarkProps) {
  return (
    <svg
      className={`brand-mark ${className}`.trim()}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path className="brand-mark__frame" d="M6 24V7.5C6 6.67 6.67 6 7.5 6H20" />
      <path className="brand-mark__frame" d="M11 26H24.5C25.33 26 26 25.33 26 24.5V12" />
      <rect className="brand-mark__accent" x="21" y="5" width="7" height="7" rx="2" />
    </svg>
  );
}

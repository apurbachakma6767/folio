interface FolioLogoProps {
  size?: number;
  className?: string;
}

export default function FolioLogo({ size = 36, className }: FolioLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Rounded square background */}
      <rect width="512" height="512" rx="112" fill="var(--accent, #10B981)" />

      {/* Vertical stroke of F */}
      <rect x="148" y="112" width="56" height="288" rx="28" fill="var(--bg-base, #0C0C0E)" />

      {/* Top horizontal bar */}
      <path
        d="M176 112 H332 C346.359 112 358 123.641 358 138 V138 C358 152.359 346.359 164 332 164 H176 V112Z"
        fill="var(--bg-base, #0C0C0E)"
      />

      {/* Page fold corner */}
      <path d="M358 112 L358 164 L306 112 Z" fill="var(--accent-hover, #059669)" />

      {/* Middle bar */}
      <rect x="176" y="228" width="140" height="52" rx="26" fill="var(--bg-base, #0C0C0E)" />
    </svg>
  );
}

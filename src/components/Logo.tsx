/** 应用标识（纯几何，无品牌素材）—— 一枚带液态高光的透明锁形。 */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="logo-body" x1="8" y1="6" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5EEAD4" />
          <stop offset="0.55" stopColor="#2DD4BF" />
          <stop offset="1" stopColor="#0E7490" />
        </linearGradient>
        <radialGradient id="logo-sheen" cx="0.3" cy="0.22" r="0.7">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.85" />
          <stop offset="0.6" stopColor="#FFFFFF" stopOpacity="0.12" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="3" y="3" width="42" height="42" rx="13" fill="url(#logo-body)" fillOpacity="0.16" stroke="#2DD4BF" strokeOpacity="0.5" />
      <path
        d="M16.5 21.5v-4a7.5 7.5 0 0 1 15 0v4"
        stroke="url(#logo-body)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect x="12" y="21.5" width="24" height="18" rx="6" fill="url(#logo-body)" />
      <rect x="12" y="21.5" width="24" height="18" rx="6" fill="url(#logo-sheen)" />
      <circle cx="24" cy="29.5" r="2.6" fill="#062A2A" fillOpacity="0.85" />
      <rect x="22.9" y="30.6" width="2.2" height="4.4" rx="1.1" fill="#062A2A" fillOpacity="0.85" />
    </svg>
  );
}

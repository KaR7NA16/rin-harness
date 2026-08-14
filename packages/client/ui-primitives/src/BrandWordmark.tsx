// rin brand wordmark (interim): text-only mark in currentColor. The full seal +
// rin letterform wordmark is a pending design asset; this removes the DeepSeek
// whale and stays legible in both themes.

import type { IconProps } from './icons/props.ts'

/**
 * Render the full brand wordmark.
 * @param props.size - height in px (default 24; width keeps the 40:24 ratio).
 * @param props.className - extra class for layout placement.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={(size * 40) / 24}
      height={size}
      className={className}
      viewBox="0 0 40 24"
      fill="none"
      aria-hidden="true"
    >
      <text
        x="1"
        y="18"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontSize="19"
        fontWeight="700"
        letterSpacing="0.3"
        fill="currentColor"
      >
        rin
      </text>
    </svg>
  )
}

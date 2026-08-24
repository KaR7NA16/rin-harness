type TooltipProps = {
  label: string
  side?: 'top' | 'left'
  className?: string
}

const SIDE_CLASSES: Record<NonNullable<TooltipProps['side']>, string> = {
  top: 'bottom-full left-0 z-50 mb-1.5 whitespace-nowrap rounded-md px-2.5 py-1 font-medium transition-opacity group-hover:opacity-100',
  left: 'right-[calc(100%+10px)] top-1/2 z-[100] min-w-max max-w-[calc(100vw-96px)] -translate-y-1/2 whitespace-nowrap rounded-[10px] px-[10px] py-[6px] font-semibold leading-none transition-[opacity,transform] group-hover:-translate-x-[2px] group-hover:opacity-100 group-focus-visible:-translate-x-[2px] group-focus-visible:opacity-100',
}

export function Tooltip({ label, side = 'top', className = '' }: TooltipProps) {
  return (
    <span
      className={`pointer-events-none absolute bg-[var(--color-inverse-surface)] text-[12px] text-[var(--color-inverse-on-surface)] opacity-0 shadow-[0_8px_20px_rgba(0,0,0,0.12)] duration-100 ${SIDE_CLASSES[side]} ${className}`}
    >
      {label}
    </span>
  )
}

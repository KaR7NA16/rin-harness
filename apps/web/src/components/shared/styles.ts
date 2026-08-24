// Shared class strings for repeated UI patterns.

// Keycap-style hint chip (e.g. "1", "Esc") shown inside buttons and panels.
// Uses an explicit text color instead of inheriting from the parent button so
// the chip stays readable on both dark primary buttons and light surfaces.
export const kbdChipClass =
  'rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)] px-2 py-0.5 font-mono text-[10px] font-semibold leading-none text-[var(--color-text-secondary)]'

// Native <select> styling shared by task/settings forms.
export const selectClass =
  'w-full h-10 px-3 pr-8 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] text-[13px] font-medium text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)] appearance-none cursor-pointer'

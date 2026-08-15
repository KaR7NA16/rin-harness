import type { ITheme } from '@xterm/xterm'

export function resolveTerminalTheme(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  const dark = document.documentElement.dataset.theme === 'dark'
  return {
    background: v('--color-background', dark ? '#121212' : '#ffffff'),
    foreground: v('--color-text-primary', dark ? '#e8e4e2' : '#1f2328'),
    cursor: v('--color-text-accent', dark ? '#7dd3fc' : '#0969da'),
    selectionBackground: dark ? 'rgba(125, 211, 252, 0.28)' : 'rgba(9, 105, 218, 0.25)',
    black: dark ? '#1f1f1f' : '#24292f',
    red: '#ff6d67',
    green: dark ? '#7ef18a' : '#1a7f37',
    yellow: dark ? '#f8c55f' : '#9a6700',
    blue: v('--color-text-accent', dark ? '#77a8ff' : '#0969da'),
    magenta: dark ? '#d699ff' : '#8250df',
    cyan: dark ? '#61d6d6' : '#1b7c83',
    white: dark ? '#e8e4e2' : '#f6f8fa',
    brightBlack: dark ? '#8f8683' : '#57606a',
    brightRed: '#ff8a85',
    brightGreen: dark ? '#9ff7a7' : '#2da44e',
    brightYellow: dark ? '#ffdd7a' : '#bf8700',
    brightBlue: dark ? '#a6c5ff' : '#218bff',
    brightMagenta: dark ? '#e3b8ff' : '#a475f9',
    brightCyan: dark ? '#8ceeee' : '#319eaa',
    brightWhite: dark ? '#ffffff' : '#6e7781',
  }
}

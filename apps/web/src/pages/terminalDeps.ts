/**
 * Terminal dependency seam for @rin/web.
 *
 * @xterm/xterm and @xterm/addon-fit are declared in package.json but cannot be
 * installed inside the sandbox, and jsdom cannot run xterm anyway. jsdom tests
 * therefore mock both packages (see Terminal.test.tsx) so the modules below are
 * replaced by fakes and never resolved from disk. On real machines the static
 * imports below load the installed packages through Vite.
 *
 * The structural types mirror only the xterm surface this page uses (see
 * @xterm/xterm typings); the real implementations are cast onto them.
 */

// oxlint-disable typescript/ban-ts-comment -- @ts-ignore stays valid whether or not the declared
// packages are installed; @ts-expect-error would break real-machine typechecks once they are.
// @ts-ignore -- declared dependency (package.json); installed on real machines, absent in the sandbox
import { Terminal as XtermTerminal } from '@xterm/xterm'
// @ts-ignore -- declared dependency (package.json); installed on real machines, absent in the sandbox
import { FitAddon as XtermFitAddon } from '@xterm/addon-fit'
// @ts-ignore -- CSS side-effect import; bundled by Vite on real machines
import '@xterm/xterm/css/xterm.css'

/** The xterm.js terminal surface used by the Terminal page. */
export type XtermTerminalHandle = {
  cols: number
  rows: number
  open: (parent: HTMLElement) => void
  write: (text: string) => void
  focus: () => void
  onData: (callback: (data: string) => void) => void
  loadAddon: (addon: unknown) => void
  dispose: () => void
}

/** The @xterm/addon-fit surface used by the Terminal page. */
export type XtermFitAddonHandle = {
  fit: () => void
  dispose: () => void
}

/** Terminal constructor options relevant to the Terminal page. */
export type XtermTerminalOptions = {
  cols: number
  rows: number
  fontFamily: string
  cursorBlink: boolean
  scrollback: number
  theme?: Record<string, string>
}

export type XtermTerminalConstructor = new (options: XtermTerminalOptions) => XtermTerminalHandle
export type XtermFitAddonConstructor = new () => XtermFitAddonHandle

/** The concrete xterm implementations (or test fakes) the page runs on. */
export type TerminalDeps = {
  Terminal: XtermTerminalConstructor
  FitAddon: XtermFitAddonConstructor
}

/** The xterm implementations used at runtime (mocked in jsdom tests). */
export const terminalDeps: TerminalDeps = {
  Terminal: XtermTerminal as unknown as XtermTerminalConstructor,
  FitAddon: XtermFitAddon as unknown as XtermFitAddonConstructor,
}

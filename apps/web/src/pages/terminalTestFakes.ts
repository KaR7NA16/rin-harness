import type { XtermFitAddonHandle, XtermTerminalHandle } from './terminalDeps'

/**
 * jsdom fakes for the xterm seam (@xterm/xterm / @xterm/addon-fit). Only used
 * by Terminal.test.tsx through vi.mock factories; never loaded by the app.
 */

/** Fake of the xterm Terminal class, recording its lifecycle and output. */
export class FakeTerminal implements XtermTerminalHandle {
  static instances: FakeTerminal[] = []

  cols = 80
  rows = 24
  opened = false
  disposed = false
  addons: unknown[] = []
  writes: string[] = []
  private dataHandler: ((data: string) => void) | null = null

  constructor() {
    FakeTerminal.instances.push(this)
  }

  open(_parent: HTMLElement) {
    this.opened = true
  }

  write(text: string) {
    this.writes.push(text)
  }

  focus() {}

  onData(callback: (data: string) => void) {
    this.dataHandler = callback
  }

  loadAddon(addon: unknown) {
    this.addons.push(addon)
  }

  dispose() {
    this.disposed = true
  }

  /** Simulate a keystroke sequence coming from the user. */
  emitData(data: string) {
    this.dataHandler?.(data)
  }
}

/** Fake of the @xterm/addon-fit FitAddon class. */
export class FakeFitAddon implements XtermFitAddonHandle {
  fitCalls = 0

  fit() {
    this.fitCalls += 1
  }

  dispose() {}
}

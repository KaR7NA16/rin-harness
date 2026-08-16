/**
 * rin doctor — tool registration tests.
 *
 * Register the doctor tool against a fake structural seam (tools registry +
 * system-prompt sections + a lazy doctor accessor) so no dsh tools graph is
 * booted. Asserts the registration surface and the execute-time behavior:
 * the tool returns the real service report and fails loud when the doctor
 * service is not mounted.
 *
 * @module @rin/doctor
 */

import { describe, expect, test } from 'vitest'
import {
  collectDoctorReport,
  DOCTOR_PROMPT_SECTION,
  DOCTOR_TOOL_NAME,
  registerDoctorTool,
  type DoctorToolSeam,
} from '../src/seam.ts'
import type { DoctorService } from '../src/service.ts'
import type { DoctorReport } from '../src/doctor.ts'

const report: DoctorReport = {
  at: '2026-01-01T00:00:00.000Z',
  runtime: { nodeVersion: 'v22.19.0', platform: 'linux', arch: 'x64', uptimeSec: 1234 },
  config: { home: '/home/u/.rin', exists: true, writable: true },
  host: { monitorAvailable: false },
  llm: { mounted: false, providers: [], anyConfigured: false },
  services: [{ name: 'monitor', mounted: false }],
}

/** A fake structural seam capturing registrations and serving a doctor. */
function makeSeam(doctor: DoctorService | undefined) {
  const tools: unknown[] = []
  const sections: Array<{ name: string; order: number; text: string }> = []
  const seam: DoctorToolSeam = {
    tools: { register(tool) { tools.push(tool); return () => undefined } },
    systemPrompt: { section(section) { sections.push(section) } },
    doctor: () => doctor,
  }
  return { seam, tools, sections }
}

describe('registerDoctorTool', () => {
  test('registers one doctor tool with no parameters', () => {
    const { seam, tools } = makeSeam({ runDiagnostics: async () => report } as DoctorService)
    registerDoctorTool(seam)
    expect(tools).toHaveLength(1)
    const tool = tools[0] as { name: string; parameters: Record<string, unknown>; description: string }
    expect(tool.name).toBe(DOCTOR_TOOL_NAME)
    expect(tool.parameters).toEqual({ type: 'object', properties: {} })
    expect(tool.description).toContain('self-diagnostic')
  })

  test('adds a short system-prompt section for the tool', () => {
    const { seam, sections } = makeSeam({ runDiagnostics: async () => report } as DoctorService)
    registerDoctorTool(seam)
    expect(sections).toHaveLength(1)
    expect(sections[0]?.name).toBe(DOCTOR_PROMPT_SECTION)
    expect(sections[0]?.order).toBeGreaterThan(100)
    expect(sections[0]?.text).toContain('doctor')
  })

  test('executing the tool returns the service report', async () => {
    const { seam, tools } = makeSeam({ runDiagnostics: async () => report } as DoctorService)
    registerDoctorTool(seam)
    const tool = tools[0] as { execute(args: unknown): Promise<unknown> }
    expect(await tool.execute({})).toEqual(report)
  })

  test('executing the tool fails loud when the doctor service is not mounted', async () => {
    const { seam, tools } = makeSeam(undefined)
    registerDoctorTool(seam)
    const tool = tools[0] as { execute(args: unknown): Promise<unknown> }
    await expect(tool.execute({})).rejects.toThrow(/not mounted/)
  })
})

describe('collectDoctorReport', () => {
  test('resolves the service report', async () => {
    expect(await collectDoctorReport({ runDiagnostics: async () => report } as DoctorService)).toEqual(report)
  })

  test('rejects with a clear error when the service is absent', async () => {
    await expect(collectDoctorReport(undefined)).rejects.toThrow(/not mounted/)
  })
})

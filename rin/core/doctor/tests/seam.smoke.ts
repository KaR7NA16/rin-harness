/**
 * rin doctor — strip-types smoke test for the tool seam.
 *
 * Registers the doctor tool against a fake structural seam and drives the
 * registered tool: a mounted service returns the real report, an unmounted
 * one fails loud. Runs under the rin smoke runner (tsx); also runnable
 * directly with node --experimental-strip-types from this directory.
 *
 * @module @rin/doctor
 */

import {
  DOCTOR_PROMPT_SECTION,
  DOCTOR_TOOL_NAME,
  registerDoctorTool,
} from '../src/seam.ts'

/** The registered-tool surface the smoke drives. */
interface RegisteredTool {
  name: string
  parameters: Record<string, unknown>
  execute(args: unknown): Promise<{ at: string; host: { monitorAvailable: boolean }; services: unknown[] }>
}

const tools: unknown[] = []
const sections: Array<{ name: string; order: number; text: string }> = []
let mounted = false

const seam = {
  tools: { register(tool) { tools.push(tool); return () => undefined } },
  systemPrompt: { section(section) { sections.push(section) } },
  doctor: () => (mounted
    ? {
      runDiagnostics: async () => ({
        at: '2026-01-01T00:00:00.000Z',
        runtime: { nodeVersion: 'v22.19.0', platform: 'linux', arch: 'x64', uptimeSec: 1234 },
        config: { home: '/home/u/.rin', exists: true, writable: true },
        host: { monitorAvailable: false },
        llm: { mounted: false, providers: [], anyConfigured: false },
        services: [{ name: 'monitor', mounted: false }],
      }),
    }
    : undefined),
}

registerDoctorTool(seam)

if (tools.length !== 1) throw new Error('expected exactly one registered tool, got ' + tools.length)
const tool = tools[0] as RegisteredTool
if (tool.name !== DOCTOR_TOOL_NAME) throw new Error('expected tool ' + DOCTOR_TOOL_NAME + ', got ' + tool.name)
if (tool.parameters.type !== 'object' || Object.keys(tool.parameters.properties ?? {}).length !== 0) {
  throw new Error('doctor must take no parameters, got: ' + JSON.stringify(tool.parameters))
}
if (sections.length !== 1 || sections[0].name !== DOCTOR_PROMPT_SECTION) throw new Error('missing doctor prompt section')

mounted = true
const value = await tool.execute({})
if (value.at !== '2026-01-01T00:00:00.000Z') throw new Error('report at mismatch')
if (value.host.monitorAvailable !== false) throw new Error('report host mismatch')
if (value.services.length !== 1) throw new Error('report services mismatch')

mounted = false
let threw = false
try { await tool.execute({}) } catch { threw = true }
if (!threw) throw new Error('unmounted tool execution must fail loud')

console.log('DOCTOR-SEAM-SMOKE-OK', { tool: tool.name, sections: sections.length })

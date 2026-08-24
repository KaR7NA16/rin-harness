/**
 * rin doctor — dsh seam registration.
 *
 * Registers the model-facing doctor tool and its short system-prompt
 * guidance. The registration drives a structural DoctorToolSeam (tools
 * registry, system-prompt sections, and a lazy doctor-service accessor), so
 * a unit test can register the tool against a fake registry without booting
 * the dsh tools graph; registerSeam() adapts the real Cordis context and
 * fails loud with a clear message when a required seam is absent.
 *
 * @module @rin/health/doctor
 */

import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DoctorReport } from './doctor.ts'
import type { DoctorService } from './service.ts'

/** Minimal structural view of the seams the tool registration touches. */
export interface DoctorToolSeam {
  tools: { register(tool: unknown): unknown }
  systemPrompt: { section(section: { name: string; order: number; text: string }): unknown }
  /** Lazy service accessor; undefined when the doctor service is not mounted. */
  doctor(): DoctorService | undefined
}

/** The model-facing tool name registered on the tools seam. */
export const DOCTOR_TOOL_NAME = 'doctor'
/** The system-prompt section name contributed by this seam. */
export const DOCTOR_PROMPT_SECTION = 'tool:doctor'

/** Model-facing description of the tool. */
export const DOCTOR_TOOL_DESCRIPTION =
  'Run an honest host self-diagnostic: node runtime (version, platform, arch, uptime), '
  + 'the rin config home existence and writability, live host metrics when the monitor '
  + 'service is mounted, the registered LLM providers (without making any inference call), '
  + 'and a mounted/absent audit of the known @rin services. Read-only.'

/**
 * Resolve one full diagnostic report from the doctor service, or fail loud
 * when the service is not mounted.
 * @param doctor - the mounted doctor service, or undefined.
 * @returns the assembled report.
 */
export async function collectDoctorReport(doctor: DoctorService | undefined): Promise<DoctorReport> {
  if (doctor === undefined) {
    throw new Error('doctor: the doctor service is not mounted on this host')
  }
  return doctor.runDiagnostics()
}

/** Format one number with a fixed width; non-finite degrades to 0.0. */
function formatNumber(value: number | undefined, digits: number): string {
  if (value === undefined || !Number.isFinite(value)) return '0.0'
  return value.toFixed(digits)
}

/**
 * Render a validated diagnostic report into a compact text summary for the
 * model. The render input is the schema-inferred shape, which both the
 * canonical DoctorReport and the validated value satisfy.
 * @param value - the validated report.
 * @returns the text content block.
 */
function renderReport(value: {
  at: string
  runtime: { nodeVersion: string; platform: string; arch: string; uptimeSec: number }
  config: { home: string; exists: boolean; writable: boolean }
  host: {
    monitorAvailable: boolean
    cpuPercent?: number
    memTotalMb?: number
    memUsedMb?: number
    memPercent?: number
    loadAvg?: number[]
    diskTotalGb?: number
    diskUsedGb?: number
    diskPercent?: number
    uptimeSec?: number
    platform?: string
  }
  llm: { mounted: boolean; providers: Array<{ id: string; name: string }>; anyConfigured: boolean }
  services: Array<{ name: string; mounted: boolean }>
}): string {
  const r = value.runtime
  const h = value.host
  const config = value.config.exists && value.config.writable
    ? 'present and writable'
    : value.config.exists ? 'present but NOT writable' : 'missing'
  const hostLine = h.monitorAvailable
    ? `monitor available: cpu ${formatNumber(h.cpuPercent, 1)}%, mem ${formatNumber(h.memUsedMb, 1)}/${formatNumber(h.memTotalMb, 1)} MB, `
      + `load ${(h.loadAvg ?? []).map(item => item.toFixed(2)).join(' / ')}, disk ${formatNumber(h.diskUsedGb, 1)}/${formatNumber(h.diskTotalGb, 1)} GB, uptime ${formatNumber(h.uptimeSec, 0)}s`
    : 'monitor unavailable (not mounted)'
  const providerIds = value.llm.providers.map(provider => provider.id).join(', ') || 'none'
  const mountedServices = value.services.filter(entry => entry.mounted).map(entry => entry.name)
  const absentServices = value.services.filter(entry => !entry.mounted).map(entry => entry.name)
  const lines = [
    `doctor report at ${value.at}`,
    `runtime: node ${r.nodeVersion} on ${r.platform}/${r.arch}, uptime ${formatNumber(r.uptimeSec, 0)}s`,
    `config home: ${value.config.home} — ${config}`,
    `host: ${hostLine}`,
    `llm: ${value.llm.mounted ? 'mounted' : 'not mounted'} — providers [${providerIds}], configured: ${value.llm.anyConfigured ? 'yes' : 'no'}`,
    `services: ${mountedServices.length}/${value.services.length} mounted`,
    mountedServices.length > 0 ? `  mounted: ${mountedServices.join(', ')}` : '  mounted: none',
    absentServices.length > 0 ? `  absent: ${absentServices.join(', ')}` : '  absent: none',
  ]
  return lines.join('\n')
}

/**
 * Register the doctor tool and its prompt guidance on a structural seam.
 * @param seam - the tools / system-prompt / doctor accessor seam.
 */
export function registerDoctorTool(seam: DoctorToolSeam): void {
  seam.systemPrompt.section({
    name: DOCTOR_PROMPT_SECTION,
    order: 108,
    text: 'doctor runs an honest host self-diagnostic: node runtime, config-home existence and writability, live host metrics when the monitor service is mounted, registered LLM providers (never making an inference call), and which @rin services are mounted. Use it when a task needs the host health or configuration state; it is read-only.',
  })

  seam.tools.register(defineTool({
    name: DOCTOR_TOOL_NAME,
    description: DOCTOR_TOOL_DESCRIPTION,
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          at: { type: 'string', required: true },
          runtime: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              nodeVersion: { type: 'string', required: true },
              platform: { type: 'string', required: true },
              arch: { type: 'string', required: true },
              uptimeSec: { type: 'number', required: true },
            },
          },
          config: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              home: { type: 'string', required: true },
              exists: { type: 'boolean', required: true },
              writable: { type: 'boolean', required: true },
              detail: { type: 'string' },
            },
          },
          host: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              monitorAvailable: { type: 'boolean', required: true },
              cpuPercent: { type: 'number' },
              memTotalMb: { type: 'number' },
              memUsedMb: { type: 'number' },
              memPercent: { type: 'number' },
              loadAvg: { type: 'array', items: { type: 'number' } },
              diskTotalGb: { type: 'number' },
              diskUsedGb: { type: 'number' },
              diskPercent: { type: 'number' },
              uptimeSec: { type: 'number' },
              platform: { type: 'string' },
            },
          },
          llm: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              mounted: { type: 'boolean', required: true },
              providers: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    name: { type: 'string', required: true },
                  },
                },
              },
              anyConfigured: { type: 'boolean', required: true },
            },
          },
          services: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                mounted: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderReport(value) }],
    },
    execute() {
      return collectDoctorReport(seam.doctor())
    },
    presentCall: () => ({ card: 'generic', title: 'Run host diagnostic', kind: 'read' }),
  }))
}

/**
 * Register the doctor seam on a real Cordis context. Fails loud when a
 * required seam is absent instead of silently registering nothing.
 * @param ctx - the plugin context (must inject tools and systemPrompt).
 */
export function registerSeam(ctx: Context): void {
  if (ctx.get('tools') === undefined || ctx.get('systemPrompt') === undefined) {
    throw new Error('rin doctor: requires the tools and systemPrompt seams; inject = ["tools", "systemPrompt"]')
  }
  registerDoctorTool({
    tools: ctx.tools,
    systemPrompt: ctx.systemPrompt,
    doctor: () => ctx.get('doctor') as DoctorService | undefined,
  })
}

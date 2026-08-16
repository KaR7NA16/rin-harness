/**
 * rin doctor — Cordis plugin entry.
 *
 * Installs the ctx.doctor service (an honest host self-diagnostic: node
 * runtime, config-home existence/writability, live monitor metrics, LLM
 * provider registration, and a mounted/absent audit of the known @rin
 * services) and registers the model-facing doctor tool plus its short
 * system-prompt guidance. The report core is Cordis-free (doctor.ts); the
 * service class and tool seam are thin.
 *
 * @module @rin/doctor
 */

import { Context } from '@deepseek-ai/cordis'
import { DoctorService, HostDoctorService } from './service.ts'
import { registerSeam } from './seam.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    doctor: DoctorService
  }
}

export { DoctorService, HostDoctorService } from './service.ts'
export type { DoctorToolSeam } from './seam.ts'
export { collectDoctorReport, DOCTOR_PROMPT_SECTION, DOCTOR_TOOL_DESCRIPTION, DOCTOR_TOOL_NAME, registerDoctorTool } from './seam.ts'
export { assembleReport, probeConfigHome, readRuntime, rinHome, RIN_AUDIT_ENTRIES } from './doctor.ts'
export type {
  DoctorAssembleDeps,
  DoctorAuditEntry,
  DoctorConfigSection,
  DoctorHostSection,
  DoctorLlmLike,
  DoctorLlmProvider,
  DoctorLlmSection,
  DoctorMonitorHostLike,
  DoctorMonitorLike,
  DoctorReport,
  DoctorRuntime,
  DoctorServiceEntry,
} from './doctor.ts'

/** Cordis plugin name. */
export const name = 'doctor'
/** Required capability and prompt seams; monitor/llm/services are read lazily. */
export const inject = ['tools', 'systemPrompt']

/**
 * Install the host doctor service and register the tool seam.
 * @param ctx - the plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(HostDoctorService)
  registerSeam(ctx)
}

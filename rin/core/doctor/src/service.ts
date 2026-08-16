/**
 * rin doctor — the ctx.doctor Cordis service.
 *
 * Thin Service classes over the Cordis-free report core (doctor.ts): the
 * abstract DoctorService declares the surface, HostDoctorService reads the
 * optional monitor / llm / @rin services lazily through ctx.get() at
 * runDiagnostics() time (never through injection), so an unmounted optional
 * service is reported as unavailable instead of failing the diagnostic. The
 * plugin apply() installs HostDoctorService; the tool seam reads it back
 * through ctx.get().
 *
 * @module @rin/doctor
 */

import { Context, Service } from '@deepseek-ai/cordis'
import {
  assembleReport,
  probeConfigHome,
  readRuntime,
  rinHome,
  RIN_AUDIT_ENTRIES,
  type DoctorAuditEntry,
  type DoctorConfigSection,
  type DoctorLlmLike,
  type DoctorMonitorLike,
  type DoctorReport,
} from './doctor.ts'

/** The doctor service exposed on the shared context. */
export abstract class DoctorService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'doctor')
  }

  /** Run one full host diagnostic and return the assembled report. */
  abstract runDiagnostics(): Promise<DoctorReport>
}

/** Options for the host doctor service; every field overrides the default. */
export interface HostDoctorServiceOptions {
  /** Config home to probe; defaults to RIN_HOME or ~/.rin. */
  configHome?: string
  /** Config-home prober; defaults to the real node:fs probeConfigHome. */
  checkConfig?: (home: string) => Promise<DoctorConfigSection>
  /** Capabilities to audit; defaults to RIN_AUDIT_ENTRIES. */
  auditEntries?: readonly DoctorAuditEntry[]
  /** Lazy service accessor; defaults to this context's ctx.get. */
  getService?: (name: string) => unknown
  /** Report timestamp; defaults to now. */
  at?: string
}

/**
 * Host doctor service: composes the real runtime facts, the real config-home
 * probe, and the context's mounted services into one report. Optional
 * services (monitor, llm, the audited @rin services) are read lazily so a
 * missing one degrades to its "unavailable" section rather than an error.
 */
export class HostDoctorService extends DoctorService {
  private readonly options: HostDoctorServiceOptions

  constructor(ctx: Context, options: HostDoctorServiceOptions = {}) {
    super(ctx)
    this.options = options
  }

  override async runDiagnostics(): Promise<DoctorReport> {
    const home = this.options.configHome ?? rinHome()
    const checkConfig = this.options.checkConfig ?? probeConfigHome
    const getService = this.options.getService ?? ((name: string) => this.ctx.get(name))
    const config = await checkConfig(home)
    return assembleReport({
      at: this.options.at ?? new Date().toISOString(),
      runtime: readRuntime(),
      config,
      monitor: getService('monitor') as DoctorMonitorLike | undefined,
      llm: getService('llm') as DoctorLlmLike | undefined,
      auditEntries: this.options.auditEntries ?? RIN_AUDIT_ENTRIES,
      serviceMounted: (service: string) => getService(service) !== undefined,
      toolMounted: (tool: string) => {
        const tools = getService('tools') as { get(name: string): unknown } | undefined
        return tools?.get(tool) !== undefined
      },
    })
  }
}

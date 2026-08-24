'use strict'

/**
 * rin web — static frontend for the @rin/host/web-server JSON API.
 *
 * Pure vanilla HTML/CSS/JS: no framework, no build step, no external
 * dependencies. It renders four panels (health, repository, environment,
 * smart pruning) from the read-only JSON API served on the same origin.
 */

const state = {
  repository: null,
  selectedProfile: null,
}

/* ---------------------------------------------------------------- */
/* DOM helpers                                                       */
/* ---------------------------------------------------------------- */

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
}

function kvRow(key, value) {
  const row = el('div', 'kv-row')
  row.appendChild(el('span', 'kv-key', key))
  row.appendChild(el('code', 'mono', String(value)))
  return row
}

function statusDot(on) {
  return el('span', 'dot ' + (on ? 'dot-on' : 'dot-off'))
}

function renderLoading(container) {
  clear(container)
  container.appendChild(el('div', 'muted', 'loading…'))
}

function renderError(container, error) {
  clear(container)
  const kind = error instanceof ApiError ? error.kind : 'error'
  const message = error && error.message ? error.message : String(error)
  const box = el('div', 'error-box')
  box.appendChild(el('span', 'error-kind', kind))
  box.appendChild(el('span', 'error-msg', message))
  container.appendChild(box)
}

/* ---------------------------------------------------------------- */
/* API access                                                        */
/* ---------------------------------------------------------------- */

class ApiError extends Error {
  constructor(kind, message) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
  }
}

async function apiFetch(path) {
  let response
  try {
    response = await fetch(path, { headers: { Accept: 'application/json' } })
  } catch (cause) {
    const detail = cause && cause.message ? cause.message : String(cause)
    throw new ApiError('network', 'network error: ' + detail)
  }

  let body = null
  try {
    body = await response.json()
  } catch (_ignored) {
    body = null
  }

  if (!response.ok) {
    const detail = body && typeof body.error === 'string' && body.error
      ? body.error
      : 'HTTP ' + response.status + ' ' + response.statusText
    throw new ApiError('http', detail)
  }
  return body
}

/* ---------------------------------------------------------------- */
/* Health panel                                                      */
/* ---------------------------------------------------------------- */

async function loadHealth() {
  const body = document.getElementById('health-body')
  renderLoading(body)
  try {
    renderHealth(await apiFetch('/api/health'))
  } catch (error) {
    renderError(body, error)
  }
}

function serviceMounted(value) {
  if (typeof value === 'boolean') return value
  if (value && typeof value === 'object' && typeof value.mounted === 'boolean') {
    return value.mounted
  }
  return null
}

function renderHealth(data) {
  const body = document.getElementById('health-body')
  clear(body)

  const ok = Boolean(data && data.ok)
  const okRow = el('div', 'kv-row')
  okRow.appendChild(el('span', 'kv-key', 'ok'))
  okRow.appendChild(statusDot(ok))
  okRow.appendChild(el('code', 'mono', ok ? 'true' : 'false'))
  body.appendChild(okRow)

  if (data && typeof data.name === 'string') body.appendChild(kvRow('name', data.name))
  if (data && typeof data.version === 'string') body.appendChild(kvRow('version', data.version))

  body.appendChild(el('h3', 'sub-title', 'services'))
  const services = data && data.services && typeof data.services === 'object'
    ? data.services
    : null
  if (!services || Object.keys(services).length === 0) {
    body.appendChild(el('div', 'muted', 'no services reported'))
    return
  }

  for (const name of Object.keys(services)) {
    const value = services[name]
    const mounted = serviceMounted(value)
    const row = el('div', 'kv-row')
    row.appendChild(el('span', 'kv-key', name))
    row.appendChild(statusDot(mounted === true))
    const label = mounted === true
      ? 'mounted'
      : mounted === false
        ? 'not mounted'
        : JSON.stringify(value)
    row.appendChild(el('code', 'mono', label))
    body.appendChild(row)
  }
}

/* ---------------------------------------------------------------- */
/* Repository panel                                                  */
/* ---------------------------------------------------------------- */

async function loadRepository() {
  const pane = document.getElementById('asset-pane')
  renderLoading(pane)
  resetDetail()

  const root = document.getElementById('root-input').value.trim()
  const params = new URLSearchParams()
  if (root) params.set('root', root)
  const query = params.toString()

  try {
    const data = await apiFetch('/api/repository' + (query ? '?' + query : ''))
    state.repository = data
    renderRepository(data)
  } catch (error) {
    state.repository = null
    renderError(pane, error)
  }
  populateProfileSelect()
}

function renderRepository(data) {
  const pane = document.getElementById('asset-pane')
  clear(pane)

  const manifest = data.manifest || {}
  const meta = manifest.metadata || {}
  const spec = manifest.spec || {}

  pane.appendChild(el('h3', 'group-title', 'manifest'))
  const manifestBox = el('div', 'manifest-box')
  manifestBox.appendChild(kvRow('id', meta.id === undefined ? '—' : meta.id))
  manifestBox.appendChild(kvRow('name', meta.name === undefined ? '—' : meta.name))
  manifestBox.appendChild(kvRow('version', meta.version === undefined ? '—' : meta.version))
  manifestBox.appendChild(kvRow('kind', manifest.kind === undefined ? '—' : manifest.kind))
  manifestBox.appendChild(kvRow('mutable', spec.mutable === undefined ? '—' : String(spec.mutable)))
  pane.appendChild(manifestBox)

  pane.appendChild(el('h3', 'group-title', 'roots'))
  const roots = spec.roots || {}
  const rootKeys = Object.keys(roots)
  const rootsBox = el('div', 'manifest-box')
  if (rootKeys.length === 0) {
    rootsBox.appendChild(el('div', 'muted', 'no roots declared'))
  } else {
    for (const key of rootKeys) rootsBox.appendChild(kvRow(key, roots[key]))
  }
  pane.appendChild(rootsBox)

  pane.appendChild(el('h3', 'group-title', 'paths'))
  const pathsBox = el('div', 'manifest-box')
  pathsBox.appendChild(kvRow('rootPath', data.rootPath === undefined ? '—' : data.rootPath))
  pathsBox.appendChild(kvRow('manifestPath', data.manifestPath === undefined ? '—' : data.manifestPath))
  pane.appendChild(pathsBox)

  const groups = [
    { key: 'environmentCatalogs', title: 'environment catalogs' },
    { key: 'environmentPackages', title: 'environment packages' },
    { key: 'environmentProfiles', title: 'environment profiles' },
    { key: 'agents', title: 'agents' },
  ]

  for (const group of groups) {
    const items = Array.isArray(data[group.key]) ? data[group.key] : []
    const section = el('section', 'asset-group')
    section.appendChild(el('h3', 'group-title', group.title + ' (' + items.length + ')'))
    if (items.length === 0) {
      section.appendChild(el('div', 'muted', 'none'))
    } else {
      const list = el('ul', 'asset-list')
      for (const item of items) list.appendChild(assetItem(group.key, item))
      section.appendChild(list)
    }
    pane.appendChild(section)
  }
}

function assetLabel(kind, item) {
  const meta = item && item.metadata
  const spec = item && item.spec
  switch (kind) {
    case 'environmentCatalogs': {
      const name = meta && (meta.name || meta.id)
      return {
        title: name || '?',
        subtitle: 'catalog · ' + (spec && spec.ecosystem ? spec.ecosystem : '?'),
      }
    }
    case 'environmentPackages': {
      const parts = []
      if (item && item.ecosystem) parts.push(item.ecosystem)
      if (item && item.version) parts.push(item.version)
      return {
        title: item && (item.name || item.id) ? (item.name || item.id) : '?',
        subtitle: parts.length ? parts.join(' · ') : 'package',
      }
    }
    case 'environmentProfiles': {
      const name = meta && (meta.name || meta.id)
      const count = spec && Array.isArray(spec.packages) ? spec.packages.length : 0
      return { title: name || '?', subtitle: count + ' packages' }
    }
    case 'agents':
      return {
        title: item && item.name ? item.name : '?',
        subtitle: item && item.description ? item.description : 'agent',
      }
    default:
      return { title: '?', subtitle: '' }
  }
}

function assetItem(kind, item) {
  const li = el('li', 'asset-item')
  const button = el('button', 'asset-button')
  button.type = 'button'
  const label = assetLabel(kind, item)
  button.appendChild(el('span', 'asset-title', label.title))
  if (label.subtitle) button.appendChild(el('span', 'asset-subtitle', label.subtitle))
  button.addEventListener('click', () => showDetail(label.title, item))
  li.appendChild(button)
  return li
}

function resetDetail() {
  document.getElementById('detail-header').textContent = 'No asset selected'
  document.getElementById('detail-pre').textContent = 'Select an asset to inspect its JSON.'
}

function showDetail(title, value) {
  document.getElementById('detail-header').textContent = title
  document.getElementById('detail-pre').textContent = JSON.stringify(value, null, 2)
}

/* ---------------------------------------------------------------- */
/* Environment panel                                                 */
/* ---------------------------------------------------------------- */

function populateProfileSelect() {
  const select = document.getElementById('profile-select')
  const planBtn = document.getElementById('plan-btn')
  const planBody = document.getElementById('plan-body')
  const previous = state.selectedProfile

  clear(select)

  const profiles = state.repository && Array.isArray(state.repository.environmentProfiles)
    ? state.repository.environmentProfiles
    : []

  if (profiles.length === 0) {
    const opt = el('option', '', '— no profiles —')
    opt.value = ''
    select.appendChild(opt)
    select.disabled = true
    planBtn.disabled = true
    state.selectedProfile = null
    clear(planBody)
    planBody.appendChild(el('div', 'muted', 'repository returned no environment profiles'))
    return
  }

  select.disabled = false
  planBtn.disabled = false

  for (const profile of profiles) {
    const meta = profile.metadata || {}
    const id = meta.id || ''
    const name = meta.name || id
    const opt = el('option', '', name)
    opt.value = id
    select.appendChild(opt)
  }

  if (previous && profiles.some(p => (p.metadata && p.metadata.id) === previous)) {
    select.value = previous
    state.selectedProfile = previous
  } else {
    state.selectedProfile = select.value
  }
}

async function loadPlan() {
  const body = document.getElementById('plan-body')
  const profileId = document.getElementById('profile-select').value
  if (!profileId) {
    clear(body)
    body.appendChild(el('div', 'muted', 'select a profile first'))
    return
  }

  renderLoading(body)

  const params = new URLSearchParams({ profile: profileId })
  const root = document.getElementById('root-input').value.trim()
  if (root) params.set('root', root)

  try {
    renderPlan(await apiFetch('/api/environment/plan?' + params.toString()))
  } catch (error) {
    renderError(body, error)
  }
}

function renderPlan(plan) {
  const body = document.getElementById('plan-body')
  clear(body)

  if (!plan || typeof plan !== 'object') {
    body.appendChild(el('div', 'muted', 'empty plan'))
    return
  }

  const summary = el('div', 'plan-summary')
  summary.appendChild(kvRow('profileId', plan.profileId === undefined ? '—' : plan.profileId))
  summary.appendChild(kvRow('profileVersion', plan.profileVersion === undefined ? '—' : plan.profileVersion))
  summary.appendChild(kvRow('packageCount', plan.packageCount === undefined ? '—' : plan.packageCount))
  const statusRow = el('div', 'kv-row')
  statusRow.appendChild(el('span', 'kv-key', 'status'))
  statusRow.appendChild(statusBadge(plan.status))
  summary.appendChild(statusRow)
  body.appendChild(summary)

  body.appendChild(el('h3', 'sub-title', 'preflight'))
  const preflight = Array.isArray(plan.preflight) ? plan.preflight : []
  if (preflight.length === 0) {
    body.appendChild(el('div', 'muted', 'no preflight checks'))
  } else {
    const list = el('div', 'preflight-list')
    for (const check of preflight) {
      const row = el('div', 'preflight-item')
      row.appendChild(preflightBadge(check && check.status))
      row.appendChild(el('span', 'mono preflight-id', check && check.id ? check.id : '?'))
      if (check && check.message) row.appendChild(el('span', 'preflight-msg', check.message))
      list.appendChild(row)
    }
    body.appendChild(list)
  }

  body.appendChild(el('h3', 'sub-title', 'stages'))
  const stages = Array.isArray(plan.stages) ? plan.stages : []
  if (stages.length === 0) {
    const note = plan.status === 'blocked' ? 'blocked plan: no stages emitted' : 'no stages'
    body.appendChild(el('div', 'muted', note))
  } else {
    for (const stage of stages) {
      const block = el('div', 'stage')
      const head = el('div', 'stage-head')
      head.appendChild(el('span', 'mono stage-id', stage && stage.id ? stage.id : '?'))
      block.appendChild(head)
      const commands = stage && Array.isArray(stage.commands) ? stage.commands : []
      if (commands.length === 0) {
        block.appendChild(el('div', 'muted', 'no commands'))
      } else {
        block.appendChild(el('pre', 'stage-commands', commands.join('\n')))
      }
      body.appendChild(block)
    }
  }
}

function statusBadge(status) {
  const span = el('span', 'badge')
  const value = String(status === undefined ? 'unknown' : status)
  span.textContent = value
  if (value === 'ready') span.classList.add('badge-ok')
  else if (value === 'blocked' || value === 'missing') span.classList.add('badge-bad')
  else span.classList.add('badge-muted')
  return span
}

function preflightBadge(status) {
  const span = el('span', 'badge preflight-status')
  const value = String(status === undefined ? 'unknown' : status)
  span.textContent = value
  if (value === 'ready') span.classList.add('badge-ok')
  else if (value === 'missing') span.classList.add('badge-bad')
  else span.classList.add('badge-muted')
  return span
}

/* ---------------------------------------------------------------- */
/* Smart pruning panel                                               */
/* ---------------------------------------------------------------- */

async function loadPruning() {
  const body = document.getElementById('pruning-body')
  renderLoading(body)
  try {
    renderPruning(await apiFetch('/api/smart-pruning/status'))
  } catch (error) {
    renderError(body, error)
  }
}

function renderPruning(data) {
  const body = document.getElementById('pruning-body')
  clear(body)

  const mounted = Boolean(data && data.mounted)
  const mountedRow = el('div', 'kv-row')
  mountedRow.appendChild(el('span', 'kv-key', 'mounted'))
  mountedRow.appendChild(statusDot(mounted))
  mountedRow.appendChild(el('code', 'mono', mounted ? 'true' : 'false'))
  body.appendChild(mountedRow)

  if (!mounted) {
    body.appendChild(el('div', 'muted', 'smart-pruning service is not mounted'))
    return
  }

  body.appendChild(kvRow('enabled', data.enabled === undefined ? '—' : String(data.enabled)))
  body.appendChild(kvRow('level', data.level === undefined ? '—' : data.level))
  if (data && typeof data.mode === 'string') body.appendChild(kvRow('mode', data.mode))
}

/* ---------------------------------------------------------------- */
/* Init & refresh                                                    */
/* ---------------------------------------------------------------- */

async function refreshAll() {
  await Promise.allSettled([
    loadHealth(),
    loadRepository(),
    loadPruning(),
  ])
  const profileId = document.getElementById('profile-select').value
  if (profileId) await loadPlan()
}

function init() {
  document.getElementById('api-base').textContent = window.location.origin

  const profileSelect = document.getElementById('profile-select')
  const placeholder = el('option', '', 'loading…')
  placeholder.value = ''
  placeholder.disabled = true
  profileSelect.appendChild(placeholder)
  profileSelect.disabled = true
  document.getElementById('plan-btn').disabled = true

  document.getElementById('refresh-btn').addEventListener('click', () => { refreshAll() })
  document.getElementById('repo-form').addEventListener('submit', event => {
    event.preventDefault()
    loadRepository()
  })
  document.getElementById('plan-btn').addEventListener('click', () => { loadPlan() })
  profileSelect.addEventListener('change', () => {
    state.selectedProfile = profileSelect.value
    loadPlan()
  })

  refreshAll()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

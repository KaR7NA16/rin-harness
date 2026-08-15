import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useApi } from './useApi'
import RepositoryPage from './pages/RepositoryPage'
import EnvironmentPage from './pages/EnvironmentPage'
import KnowledgePage from './pages/KnowledgePage'
import SessionSearchPage from './pages/SessionSearchPage'
import PromptMemoryPage from './pages/PromptMemoryPage'
import SkillMemoryPage from './pages/SkillMemoryPage'
import EvolutionPage from './pages/EvolutionPage'
import TokenOptimizationPage from './pages/TokenOptimizationPage'
import NotesPage from './pages/NotesPage'
import SandboxesPage from './pages/SandboxesPage'
import AgentWorkspacePage from './pages/AgentWorkspacePage'

interface NavItem {
  path: string
  label: string
  icon: string
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Assets',
    items: [
      { path: '/repository', label: 'Repository', icon: 'inventory_2' },
      { path: '/environment', label: 'Environment', icon: 'terminal' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { path: '/agents', label: 'Agents', icon: 'smart_toy' },
      { path: '/sandboxes', label: 'Sandboxes', icon: 'box' },
    ],
  },
  {
    label: 'Memory',
    items: [
      { path: '/knowledge', label: 'Knowledge', icon: 'auto_stories' },
      { path: '/sessions', label: 'SessionSearch', icon: 'history' },
      { path: '/prompt-memory', label: 'PromptMemory', icon: 'psychology' },
      { path: '/skill-memory', label: 'SkillMemory', icon: 'construction' },
      { path: '/evolution', label: 'Evolution', icon: 'auto_graph' },
    ],
  },
  {
    label: 'Optimization',
    items: [
      { path: '/token-optimization', label: 'TokenOptimization', icon: 'tune' },
    ],
  },
  {
    label: 'Notes',
    items: [
      { path: '/notes', label: 'Notes', icon: 'edit_note' },
    ],
  },
]

interface HealthResponse {
  ok: boolean
  name: string
  version: string
}

function SidebarHealth() {
  const health = useApi<HealthResponse>('/api/health')
  const ok = health.data?.ok === true
  return (
    <div className="sidebar-health">
      <span className={`status-dot ${ok ? 'on' : health.error !== null ? 'bad' : ''}`} />
      <span className="sidebar-health-text">
        {ok ? 'host online' : health.loading ? 'checking host…' : 'host offline'}
      </span>
      {health.data !== null ? <span className="sidebar-health-version">{health.data.version}</span> : null}
    </div>
  )
}

function SidebarBrand() {
  return (
    <div className="sidebar-brand">
      <img className="brand-mark" src="/app-icon.svg" alt="rin" />
      <div className="brand-copy">
        <div className="brand-name">rin</div>
        <div className="brand-subtitle">harness · web</div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <SidebarBrand />
        <nav className="sidebar-nav">
          {NAV_GROUPS.map(group => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map(item => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
                >
                  <span className="nav-icon material-symbols-outlined">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <SidebarHealth />
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/repository" replace />} />
          <Route path="/repository" element={<RepositoryPage />} />
          <Route path="/environment" element={<EnvironmentPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/sessions" element={<SessionSearchPage />} />
          <Route path="/prompt-memory" element={<PromptMemoryPage />} />
          <Route path="/skill-memory" element={<SkillMemoryPage />} />
          <Route path="/evolution" element={<EvolutionPage />} />
          <Route path="/token-optimization" element={<TokenOptimizationPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/sandboxes" element={<SandboxesPage />} />
          <Route path="/agents" element={<AgentWorkspacePage />} />
          <Route path="*" element={<Navigate to="/repository" replace />} />
        </Routes>
      </main>
    </div>
  )
}

import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
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
}

const NAV_ITEMS: NavItem[] = [
  { path: '/repository', label: 'Repository' },
  { path: '/environment', label: 'Environment' },
  { path: '/knowledge', label: 'Knowledge' },
  { path: '/sessions', label: 'SessionSearch' },
  { path: '/prompt-memory', label: 'PromptMemory' },
  { path: '/skill-memory', label: 'SkillMemory' },
  { path: '/evolution', label: 'Evolution' },
  { path: '/token-optimization', label: 'TokenOptimization' },
  { path: '/notes', label: 'Notes' },
  { path: '/sandboxes', label: 'Sandboxes' },
  { path: '/agents', label: 'Agents' },
]

export default function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">rin</div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
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

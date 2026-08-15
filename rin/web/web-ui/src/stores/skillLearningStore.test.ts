import { beforeEach, describe, expect, it, vi } from 'vitest'

import { skillsApi } from '../api/skills'
import type { SkillCandidate, SkillLearningOverview } from '../types/skill'
import { useSkillLearningStore } from './skillLearningStore'

vi.mock('../api/skills', () => ({
  skillsApi: {
    learning: vi.fn(),
    updateLearningConfig: vi.fn(),
    approveCandidate: vi.fn(),
    rejectCandidate: vi.fn(),
  },
}))

function makeOverview(): SkillLearningOverview {
  return {
    config: { version: 1, mode: 'suggest', minToolUses: 2, minConfidence: 0.5, autoApproveConfidence: 0.9 },
    pendingCandidates: [],
    recentCandidates: [],
    events: [],
    memories: [],
  }
}

function makeCandidate(): SkillCandidate {
  return {
    version: 1,
    id: 'cand-1',
    status: 'pending',
    action: 'create',
    scope: 'project',
    name: 'new-skill',
    description: '',
    whenToUse: '',
    reason: '',
    evidence: [],
    confidence: 0.9,
    markdown: '',
    sourceFingerprint: 'fp',
    sourceToolUses: 0,
    createdAt: '',
    updatedAt: '',
  }
}

describe('skillLearningStore', () => {
  beforeEach(() => {
    useSkillLearningStore.setState({
      overview: null,
      isLoading: false,
      pendingCandidateId: null,
      error: null,
    })
    vi.clearAllMocks()
  })

  it('loads the learning overview', async () => {
    const overview = makeOverview()
    vi.mocked(skillsApi.learning).mockResolvedValue({ overview })

    await useSkillLearningStore.getState().fetchOverview()

    expect(useSkillLearningStore.getState().overview).toEqual(overview)
    expect(useSkillLearningStore.getState().isLoading).toBe(false)
  })

  it('keeps the loading flag false for quiet refreshes', async () => {
    vi.mocked(skillsApi.learning).mockResolvedValue({ overview: makeOverview() })

    await useSkillLearningStore.getState().fetchOverview(undefined, true)

    expect(skillsApi.learning).toHaveBeenCalledWith(undefined)
    expect(useSkillLearningStore.getState().isLoading).toBe(false)
  })

  it('optimistically applies a mode change and rolls back on failure', async () => {
    useSkillLearningStore.setState({ overview: makeOverview() })
    vi.mocked(skillsApi.updateLearningConfig).mockRejectedValue(new Error('boom'))

    await expect(useSkillLearningStore.getState().setMode('auto')).rejects.toThrow('boom')

    expect(useSkillLearningStore.getState().overview?.config.mode).toBe('suggest')
  })

  it('persists a mode change on success', async () => {
    useSkillLearningStore.setState({ overview: makeOverview() })
    const config = { version: 1, mode: 'auto', minToolUses: 2, minConfidence: 0.5, autoApproveConfidence: 0.9 }
    vi.mocked(skillsApi.updateLearningConfig).mockResolvedValue({ ok: true, config })
    vi.mocked(skillsApi.learning).mockResolvedValue({ overview: { ...makeOverview(), config } })

    await useSkillLearningStore.getState().setMode('auto')

    expect(useSkillLearningStore.getState().overview?.config.mode).toBe('auto')
  })

  it('approves a candidate and clears the pending id', async () => {
    vi.mocked(skillsApi.approveCandidate).mockResolvedValue({ ok: true, candidate: makeCandidate() })
    vi.mocked(skillsApi.learning).mockResolvedValue({ overview: makeOverview() })

    await useSkillLearningStore.getState().approveCandidate('cand-1')

    expect(skillsApi.approveCandidate).toHaveBeenCalledWith('cand-1')
    expect(useSkillLearningStore.getState().pendingCandidateId).toBeNull()
  })

  it('rejects a candidate and clears the pending id', async () => {
    vi.mocked(skillsApi.rejectCandidate).mockResolvedValue({ ok: true, candidate: makeCandidate() })
    vi.mocked(skillsApi.learning).mockResolvedValue({ overview: makeOverview() })

    await useSkillLearningStore.getState().rejectCandidate('cand-1')

    expect(skillsApi.rejectCandidate).toHaveBeenCalledWith('cand-1')
    expect(useSkillLearningStore.getState().pendingCandidateId).toBeNull()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { skillsApi } from '../api/skills'
import type { SkillDetail, SkillMeta } from '../types/skill'
import { useSkillStore } from './skillStore'

vi.mock('../api/skills', () => ({
  skillsApi: {
    list: vi.fn(),
    detail: vi.fn(),
    setEnabled: vi.fn(),
  },
}))

function makeSkill(name: string, enabled?: boolean): SkillMeta {
  return {
    name,
    description: 'desc',
    source: 'user',
    userInvocable: true,
    contentLength: 0,
    hasDirectory: false,
    enabled,
  }
}

function makeDetail(name: string, enabled?: boolean): SkillDetail {
  return {
    meta: makeSkill(name, enabled),
    tree: [],
    files: [],
    skillRoot: '/skills',
  }
}

describe('skillStore', () => {
  beforeEach(() => {
    useSkillStore.setState({
      skills: [],
      selectedSkill: null,
      selectedSkillReturnTab: 'skills',
      isLoading: false,
      isDetailLoading: false,
      error: null,
    })
    vi.clearAllMocks()
  })

  it('loads skills and normalizes missing enabled flags to true', async () => {
    vi.mocked(skillsApi.list).mockResolvedValue({ skills: [makeSkill('a'), makeSkill('b', false)] })

    await useSkillStore.getState().fetchSkills()

    expect(useSkillStore.getState().skills).toMatchObject([
      { name: 'a', enabled: true },
      { name: 'b', enabled: false },
    ])
  })

  it('records an error message when listing fails', async () => {
    vi.mocked(skillsApi.list).mockRejectedValue(new Error('boom'))

    await useSkillStore.getState().fetchSkills()

    expect(useSkillStore.getState().error).toBe('boom')
  })

  it('loads a skill detail with its return tab', async () => {
    vi.mocked(skillsApi.detail).mockResolvedValue({ detail: makeDetail('a') })

    await useSkillStore.getState().fetchSkillDetail('user', 'a', undefined, 'plugins')

    expect(skillsApi.detail).toHaveBeenCalledWith('user', 'a', undefined)
    expect(useSkillStore.getState()).toMatchObject({
      selectedSkill: makeDetail('a'),
      selectedSkillReturnTab: 'plugins',
    })
  })

  it('persists an enabled change on success', async () => {
    vi.mocked(skillsApi.setEnabled).mockResolvedValue({ ok: true, disabledSkills: [] })
    useSkillStore.setState({ skills: [makeSkill('a', true)] })

    await useSkillStore.getState().setSkillEnabled('user', 'a', false)

    expect(skillsApi.setEnabled).toHaveBeenCalledWith('user', 'a', false)
    expect(useSkillStore.getState().skills[0]).toMatchObject({ enabled: false })
  })

  it('rolls back the optimistic toggle when the api fails', async () => {
    vi.mocked(skillsApi.setEnabled).mockRejectedValue(new Error('boom'))
    useSkillStore.setState({ skills: [makeSkill('a', true)] })

    await expect(useSkillStore.getState().setSkillEnabled('user', 'a', false)).rejects.toThrow('boom')

    expect(useSkillStore.getState().skills).toEqual([makeSkill('a', true)])
    expect(useSkillStore.getState().error).toBe('boom')
  })

  it('clears the selection and return tab', () => {
    useSkillStore.setState({ selectedSkill: makeDetail('a'), selectedSkillReturnTab: 'plugins' })

    useSkillStore.getState().clearSelection()

    expect(useSkillStore.getState()).toMatchObject({ selectedSkill: null, selectedSkillReturnTab: 'skills' })
  })
})

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryApi } from '../api/memory'
import { useSettingsStore } from '../stores/settingsStore'
import { MemoryCenter } from './MemoryCenter'

vi.mock('../api/memory', () => ({
  memoryApi: {
    field: vi.fn(),
    scenes: vi.fn(),
    recallCycles: vi.fn(),
    representation: vi.fn(),
    recallCycle: vi.fn(),
    correct: vi.fn(),
    restrictInfluence: vi.fn(),
    revokeInfluence: vi.fn(),
    erasePreview: vi.fn(),
    eraseAuthorize: vi.fn(),
    eraseCommit: vi.fn(),
  },
}))

const field = vi.mocked(memoryApi.field)
const scenes = vi.mocked(memoryApi.scenes)
const recallCycles = vi.mocked(memoryApi.recallCycles)
const representation = vi.mocked(memoryApi.representation)
const correct = vi.mocked(memoryApi.correct)
const restrictInfluence = vi.mocked(memoryApi.restrictInfluence)
const revokeInfluence = vi.mocked(memoryApi.revokeInfluence)
const erasePreview = vi.mocked(memoryApi.erasePreview)
const eraseAuthorize = vi.mocked(memoryApi.eraseAuthorize)
const eraseCommit = vi.mocked(memoryApi.eraseCommit)

describe('MemoryCenter', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    field.mockReset().mockResolvedValue({
      ownerId: 'rin',
      version: 3,
      updatedAt: '2026-01-01T00:00:00.000Z',
      participants: [],
      goals: [],
      affect: { valence: 0, arousal: 0, control: 0.5 },
      predictions: [],
      predictionErrors: [],
      activeOpenLoops: [],
      candidateActions: [],
      activeMemoryCoalition: [],
      uncertainty: [],
    })
    scenes.mockReset().mockResolvedValue([
      {
        id: 'scene-1',
        version: '2026-01-01T00:00:00.000Z',
        status: 'open',
        participants: ['user-1'],
        environment: 'workspace',
        goals: [],
        observationCount: 2,
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    recallCycles.mockReset().mockResolvedValue([
      { cycleId: 'cycle-1', createdAt: '2026-01-01T00:01:00.000Z', materializedVersion: 3, itemCount: 4 },
    ])
    representation.mockReset().mockResolvedValue({
      id: 'scene-1',
      form: 'scene',
      data: { observations: ['the old understanding'] },
      state: { persistence: 'durable', activation: 'dormant', integration: 'integrated', epistemic: 'observed', influence: 'blocked' },
      dynamics: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    correct.mockReset().mockResolvedValue({})
    restrictInfluence.mockReset().mockResolvedValue({})
    revokeInfluence.mockReset().mockResolvedValue({})
    erasePreview.mockReset()
    eraseAuthorize.mockReset()
    eraseCommit.mockReset()
  })

  it('renders the current field, scenes, and recall explanations', async () => {
    render(<MemoryCenter />)

    const fieldSection = within(screen.getByLabelText('Current field'))
    expect(await screen.findByText('scene-1')).toBeInTheDocument()
    expect(fieldSection.getByText('version')).toBeInTheDocument()
    expect(fieldSection.getByText('3')).toBeInTheDocument()
    expect(screen.getByText(/cycle-1/)).toBeInTheDocument()
  })

  it('renders explanatory empty states when there is no data', async () => {
    scenes.mockResolvedValue([])
    recallCycles.mockResolvedValue([])
    render(<MemoryCenter />)

    expect(await screen.findByText('No scenes recorded yet.')).toBeInTheDocument()
    expect(screen.getByText('No recall cycles yet.')).toBeInTheDocument()
  })

  it('dispatches restrict and revoke owner intents from the scene rows', async () => {
    render(<MemoryCenter />)

    fireEvent.click(await screen.findByRole('button', { name: 'Restrict' }))
    await waitFor(() => expect(restrictInfluence).toHaveBeenCalledWith({
      memoryId: 'scene-1',
      surfaces: ['recall'],
      reason: 'the owner restricted this scene from the Memory Center',
      ownerId: 'rin-owner',
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(revokeInfluence).toHaveBeenCalledWith({
      memoryId: 'scene-1',
      reason: 'the owner revoked this scene from the Memory Center',
      ownerId: 'rin-owner',
    }))
  })

  it('loads a representation and submits the owner correction', async () => {
    render(<MemoryCenter />)

    fireEvent.click(await screen.findByRole('button', { name: 'Correct' }))
    await waitFor(() => expect(representation).toHaveBeenCalledWith('scene-1'))
    const data = screen.getByRole('textbox', { name: 'Correction data' }) as HTMLTextAreaElement
    await waitFor(() => expect(data.value).toContain('the old understanding'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Correction explanation' }), {
      target: { value: 'the owner corrected what happened' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit correction' }))
    await waitFor(() => expect(correct).toHaveBeenCalledWith({
      memoryId: 'scene-1',
      replacement: { form: 'scene', data: { observations: ['the old understanding'] } },
      explanation: 'the owner corrected what happened',
      ownerId: 'rin-owner',
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('Corrected scene-1')
  })

  it('previews the erase scope before committing the authorized erasure', async () => {
    erasePreview.mockResolvedValue({
      rootMemoryIds: ['scene-1'],
      erasedMemoryIds: ['scene-1'],
      retractedLinkIds: ['link-1'],
      dependentMemoryIds: ['structure-1'],
      unaffectedMemoryIds: ['scene-2'],
      scopeHash: 'hash-1',
    })
    eraseAuthorize.mockResolvedValue({
      authorization: { authorizationId: 'auth-1', memoryIds: ['scene-1'], expiresAt: '2026-01-01T00:20:00.000Z', scopeHash: 'hash-1' },
      preview: {
        rootMemoryIds: ['scene-1'],
        erasedMemoryIds: ['scene-1'],
        retractedLinkIds: ['link-1'],
        dependentMemoryIds: ['structure-1'],
        unaffectedMemoryIds: ['scene-2'],
        scopeHash: 'hash-1',
      },
    })
    eraseCommit.mockResolvedValue({ erasedMemoryIds: ['scene-1'] })

    render(<MemoryCenter />)

    const commit = screen.getByRole('button', { name: 'Commit erasure' })
    expect(commit).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Erase roots' }), { target: { value: 'scene-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview scope' }))
    await waitFor(() => expect(erasePreview).toHaveBeenCalledWith(['scene-1']))
    const previewPanel = await waitFor(() => {
      const el = document.querySelector('[data-erase-preview]')
      if (el === null) throw new Error('erase preview panel not rendered yet')
      return el
    })
    expect(previewPanel).toHaveTextContent('Dependents losing evidence: structure-1')

    fireEvent.click(commit)
    await waitFor(() => expect(eraseCommit).toHaveBeenCalledWith({ authorizationId: 'auth-1', ownerId: 'rin-owner' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Erased 1 memories')
  })
})

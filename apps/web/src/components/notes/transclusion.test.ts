import { describe, expect, it } from 'vitest'
import { expandTransclusions, renderTransclusion, transclusionTargets } from './transclusion'

describe('note transclusion', () => {
  it('extracts transclusion targets', () => {
    expect(transclusionTargets('Before\n\n![[alpha]]\n\n![[beta|Alias]]')).toEqual(['alpha', 'beta'])
  })

  it('renders a target as a callout', () => {
    expect(renderTransclusion('alpha', '# Title\n\nBody')).toContain('> [!note] alpha')
    expect(renderTransclusion('alpha', 'Body')).toContain('> Body')
  })

  it('expands readable targets and warns for missing ones', async () => {
    const read = async (target: string) => {
      if (target === 'alpha.md') return { content: '# Alpha' }
      throw new Error('missing')
    }
    const result = await expandTransclusions('![[alpha]]\n\n![[missing]]', read)
    expect(result).toContain('> [!note] alpha')
    expect(result).toContain('# Alpha')
    expect(result).toContain('> [!warning] Unable to transclude [[missing]]')
  })
})

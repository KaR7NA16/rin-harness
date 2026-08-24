import { describe, expect, test } from 'vitest'
import {
  extractWikilinkTargets,
  knowledgeDocumentNodeId,
  knowledgeSourceNodeId,
} from '../../src/knowledge/entities.ts'

describe('knowledge node ids', () => {
  test('prefixes source and document ids with their stable namespace', () => {
    expect(knowledgeSourceNodeId('abc')).toBe('knowledge_source:abc')
    expect(knowledgeDocumentNodeId('abc')).toBe('knowledge_document:abc')
  })
})

describe('extractWikilinkTargets', () => {
  test('extracts deduplicated wikilink targets in first-seen order', () => {
    const content = 'See [[work/ideas]] and [[work/ideas]] and [[meeting notes]].'
    expect(extractWikilinkTargets(content)).toEqual(['work/ideas', 'meeting notes'])
  })

  test('strips alias, heading, and block suffixes', () => {
    const content = '[[note|alias]] [[note#heading]] [[note^block]]'
    expect(extractWikilinkTargets(content)).toEqual(['note'])
  })

  test('ignores empty targets and non-wikilink text', () => {
    const content = '[[ ]] plain text [not a link](url)'
    expect(extractWikilinkTargets(content)).toEqual([])
  })
})

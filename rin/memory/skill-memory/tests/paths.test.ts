import { describe, expect, test } from 'vitest'
import path from 'node:path'
import {
  getSkillMemoryDir,
  getSkillMemoryId,
  getSkillUsageSidecarPath,
} from '../src/paths.ts'
import type { SkillMemoryRef } from '../src/types.ts'

const ref: SkillMemoryRef = {
  skillName: 'frontend-design',
  source: 'plugin',
  loadedFrom: 'skills',
}

describe('skill memory storage layout', () => {
  test('derives global paths only from injected roots', () => {
    const roots = { globalConfigRoot: path.join('home', '.rin') }
    expect(getSkillMemoryDir(ref, 'global', roots)).toBe(
      path.join(roots.globalConfigRoot, 'skill-memory', getSkillMemoryId(ref)),
    )
    expect(getSkillUsageSidecarPath(ref, 'global', roots)).toBe(
      path.join(roots.globalConfigRoot, 'skills', '.usage.json'),
    )
  })

  test('derives project paths from a separately injected config root', () => {
    const roots = {
      globalConfigRoot: path.join('home', '.rin'),
      projectConfigRoot: path.join('project', '.rin'),
    }
    expect(getSkillMemoryDir(ref, 'project', roots)).toBe(
      path.join(roots.projectConfigRoot, 'skill-memory', getSkillMemoryId(ref)),
    )
    expect(getSkillUsageSidecarPath(ref, 'project', roots)).toBe(
      path.join(roots.projectConfigRoot, 'skills', '.usage.json'),
    )
  })

  test('rejects project scope without an injected project root', () => {
    expect(() => getSkillMemoryDir(ref, 'project', {
      globalConfigRoot: path.join('home', '.rin'),
    })).toThrow('rin skill-memory: project scope requires a project config root')
  })
})

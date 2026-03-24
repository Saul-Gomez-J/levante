import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock modelService before importing selectableModels
// Use the relative path that the source file resolves to via @/ alias
vi.mock('@/services/modelService', () => ({
  modelService: {
    initialize: vi.fn(),
    getAvailableModels: vi.fn().mockResolvedValue([]),
    getAllProvidersWithSelectedModels: vi.fn().mockResolvedValue({ providers: [], totalModelCount: 0 }),
  },
}))

import { resolveStoredModelForCatalog, formatStoredModelForDisplay } from './selectableModels'
import { buildModelRef } from '../../shared/modelRefs'
import type { Model } from '../../types/models'
import type { SelectableModelsResult } from './selectableModels'

function makeModel(id: string, name?: string): Model {
  return {
    id,
    name: name ?? id,
    provider: 'test',
    contextLength: 4096,
    capabilities: [],
    isAvailable: true,
    userDefined: false,
  }
}

describe('resolveStoredModelForCatalog', () => {
  it('resolves exact match', () => {
    const catalog: SelectableModelsResult = {
      availableModels: [makeModel('gpt-4o')],
      groupedModelsByProvider: null,
    }
    expect(resolveStoredModelForCatalog('gpt-4o', catalog)).toBe('gpt-4o')
  })

  it('resolves legacy raw unique match', () => {
    const qualifiedId = buildModelRef('openrouter', 'gpt-4o')
    const catalog: SelectableModelsResult = {
      availableModels: [makeModel(qualifiedId, 'GPT-4o')],
      groupedModelsByProvider: null,
    }
    expect(resolveStoredModelForCatalog('gpt-4o', catalog)).toBe(qualifiedId)
  })

  it('prioritizes platform on legacy collision', () => {
    const platformRef = buildModelRef('levante-platform', 'gpt-4o')
    const openrouterRef = buildModelRef('openrouter', 'gpt-4o')
    const catalog: SelectableModelsResult = {
      availableModels: [
        makeModel(platformRef, 'GPT-4o (Platform)'),
        makeModel(openrouterRef, 'GPT-4o (OR)'),
      ],
      groupedModelsByProvider: null,
    }
    expect(resolveStoredModelForCatalog('gpt-4o', catalog)).toBe(platformRef)
  })

  it('returns null on ambiguous standalone collision', () => {
    const orRef = buildModelRef('openrouter', 'gpt-4o')
    const oaiRef = buildModelRef('openai', 'gpt-4o')
    const catalog: SelectableModelsResult = {
      availableModels: [
        makeModel(orRef, 'GPT-4o (OR)'),
        makeModel(oaiRef, 'GPT-4o (OAI)'),
      ],
      groupedModelsByProvider: null,
    }
    expect(resolveStoredModelForCatalog('gpt-4o', catalog)).toBeNull()
  })

  it('returns null for unknown model', () => {
    const catalog: SelectableModelsResult = {
      availableModels: [makeModel('gpt-4o')],
      groupedModelsByProvider: null,
    }
    expect(resolveStoredModelForCatalog('unknown-model', catalog)).toBeNull()
  })

  it('platform pure returns raw IDs', () => {
    const catalog: SelectableModelsResult = {
      availableModels: [makeModel('gpt-4o'), makeModel('claude-3')],
      groupedModelsByProvider: null,
    }
    // Raw IDs work as-is in pure mode
    expect(resolveStoredModelForCatalog('gpt-4o', catalog)).toBe('gpt-4o')
  })
})

describe('formatStoredModelForDisplay', () => {
  it('returns model name when found', () => {
    const catalog: SelectableModelsResult = {
      availableModels: [makeModel('gpt-4o', 'GPT-4o')],
      groupedModelsByProvider: null,
    }
    expect(formatStoredModelForDisplay('gpt-4o', catalog)).toBe('GPT-4o')
  })

  it('returns raw ID for unknown models', () => {
    const catalog: SelectableModelsResult = {
      availableModels: [],
      groupedModelsByProvider: null,
    }
    expect(formatStoredModelForDisplay('unknown-model', catalog)).toBe('unknown-model')
  })

  it('returns raw ID from qualified ref when not in catalog', () => {
    const ref = buildModelRef('openrouter', 'openai/gpt-4o')
    const catalog: SelectableModelsResult = {
      availableModels: [],
      groupedModelsByProvider: null,
    }
    expect(formatStoredModelForDisplay(ref, catalog)).toBe('openai/gpt-4o')
  })

  it('returns empty string for null/undefined', () => {
    const catalog: SelectableModelsResult = {
      availableModels: [],
      groupedModelsByProvider: null,
    }
    expect(formatStoredModelForDisplay(null, catalog)).toBe('')
    expect(formatStoredModelForDisplay(undefined, catalog)).toBe('')
  })
})

import { describe, it, expect } from 'vitest'
import { buildModelRef, parseModelRef, isQualifiedModelRef, getRawModelId } from './modelRefs'

describe('modelRefs', () => {
  describe('buildModelRef + parseModelRef roundtrip', () => {
    it('roundtrips simple IDs', () => {
      const ref = buildModelRef('openrouter', 'openai/gpt-4o')
      const parsed = parseModelRef(ref)
      expect(parsed).toEqual({ providerId: 'openrouter', modelId: 'openai/gpt-4o' })
    })

    it('roundtrips platform provider', () => {
      const ref = buildModelRef('levante-platform', 'gpt-4o')
      const parsed = parseModelRef(ref)
      expect(parsed).toEqual({ providerId: 'levante-platform', modelId: 'gpt-4o' })
    })

    it('roundtrips IDs with special characters', () => {
      const ref = buildModelRef('my::provider', 'model::with::colons')
      const parsed = parseModelRef(ref)
      expect(parsed).toEqual({ providerId: 'my::provider', modelId: 'model::with::colons' })
    })
  })

  describe('getRawModelId', () => {
    it('returns raw ID for qualified refs', () => {
      const ref = buildModelRef('openrouter', 'openai/gpt-4o')
      expect(getRawModelId(ref)).toBe('openai/gpt-4o')
    })

    it('returns the same string for non-qualified values', () => {
      expect(getRawModelId('gpt-4o')).toBe('gpt-4o')
    })
  })

  describe('isQualifiedModelRef', () => {
    it('returns true for qualified refs', () => {
      expect(isQualifiedModelRef(buildModelRef('openrouter', 'gpt-4o'))).toBe(true)
    })

    it('returns false for raw model IDs', () => {
      expect(isQualifiedModelRef('gpt-4o')).toBe(false)
      expect(isQualifiedModelRef('openai/gpt-4o')).toBe(false)
    })
  })

  describe('parseModelRef', () => {
    it('returns null for non-qualified strings', () => {
      expect(parseModelRef('gpt-4o')).toBeNull()
      expect(parseModelRef('openai/gpt-4o')).toBeNull()
    })

    it('returns null for empty parts', () => {
      expect(parseModelRef('::modelId')).toBeNull()
      expect(parseModelRef('providerId::')).toBeNull()
    })
  })
})

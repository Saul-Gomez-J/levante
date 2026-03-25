import { modelService } from '@/services/modelService'
import { buildModelRef, getRawModelId, isQualifiedModelRef } from '../../shared/modelRefs'
import type { Model, GroupedModelsByProvider, ProviderConfig } from '../../types/models'

export type SelectableModelsResult = {
  availableModels: Model[]
  groupedModelsByProvider: GroupedModelsByProvider | null
}

const PLATFORM_PROVIDER_ID = 'levante-platform'

function makeSyntheticPlatformProvider(models: Model[]): ProviderConfig {
  return {
    id: PLATFORM_PROVIDER_ID,
    name: 'Levante Platform',
    type: 'levante-platform',
    apiKey: undefined,
    baseUrl: undefined,
    models,
    selectedModelIds: undefined,
    isActive: false,
    settings: {},
    modelSource: 'dynamic' as const,
  }
}

function qualifyModels(providerId: string, models: Model[]): Model[] {
  return models.map((m) => ({
    ...m,
    id: buildModelRef(providerId, m.id),
  }))
}

export async function loadSelectableModels(params: {
  appMode: 'platform' | 'standalone' | null
  useOtherProviders: boolean
  platformModels: Model[]
}): Promise<SelectableModelsResult> {
  const { appMode, useOtherProviders, platformModels } = params

  // Standalone: unchanged behavior
  if (appMode !== 'platform') {
    await modelService.initialize()
    const availableModels = await modelService.getAvailableModels()
    const groupedModelsByProvider = await modelService.getAllProvidersWithSelectedModels()
    return { availableModels, groupedModelsByProvider }
  }

  // Platform pure: raw IDs, no grouping
  if (!useOtherProviders) {
    return {
      availableModels: platformModels,
      groupedModelsByProvider: null,
    }
  }

  // Platform hybrid: qualified IDs for all sources
  await modelService.initialize()
  const standaloneGrouped = await modelService.getAllProvidersWithSelectedModels()

  // Qualify platform models
  const qualifiedPlatformModels = qualifyModels(PLATFORM_PROVIDER_ID, platformModels)

  // Qualify standalone models per provider
  const qualifiedStandaloneProviders = (standaloneGrouped?.providers ?? []).map((pw) => ({
    ...pw,
    models: qualifyModels(pw.provider.id, pw.models),
  }))

  // Build combined grouped result
  const platformGroup = {
    provider: makeSyntheticPlatformProvider(qualifiedPlatformModels),
    models: qualifiedPlatformModels,
    modelCount: qualifiedPlatformModels.length,
  }

  const allProviders = [platformGroup, ...qualifiedStandaloneProviders]
  const allModels = allProviders.flatMap((p) => p.models)

  return {
    availableModels: allModels,
    groupedModelsByProvider: {
      providers: allProviders,
      totalModelCount: allModels.length,
    },
  }
}

export function resolveStoredModelForCatalog(
  storedValue: string | null | undefined,
  catalog: SelectableModelsResult
): string | null {
  if (!storedValue) return null

  // 1. Exact match by id
  const exactMatch = catalog.availableModels.find((m) => m.id === storedValue)
  if (exactMatch) return exactMatch.id

  // Also check grouped
  if (catalog.groupedModelsByProvider) {
    for (const group of catalog.groupedModelsByProvider.providers) {
      const found = group.models.find((m) => m.id === storedValue)
      if (found) return found.id
    }
  }

  // 2. Legacy raw value resolution
  const rawValue = getRawModelId(storedValue)
  const matches: Model[] = []
  for (const m of catalog.availableModels) {
    if (getRawModelId(m.id) === rawValue) {
      matches.push(m)
    }
  }

  if (matches.length === 1) return matches[0].id

  if (matches.length > 1) {
    // Prefer platform
    const platformMatch = matches.find(
      (m) => isQualifiedModelRef(m.id) && getRawModelId(m.id) === rawValue &&
        m.id.startsWith(encodeURIComponent(PLATFORM_PROVIDER_ID) + '::')
    )
    if (platformMatch) return platformMatch.id
    // Multiple standalone - ambiguous
    return null
  }

  return null
}

export function formatStoredModelForDisplay(
  storedValue: string | null | undefined,
  catalog: SelectableModelsResult
): string {
  if (!storedValue) return ''

  // Try to find in catalog
  const resolved = resolveStoredModelForCatalog(storedValue, catalog)
  if (resolved) {
    const model = catalog.availableModels.find((m) => m.id === resolved)
    if (model?.name) return model.name
    return getRawModelId(resolved)
  }

  // Not in catalog - show raw id
  return getRawModelId(storedValue)
}

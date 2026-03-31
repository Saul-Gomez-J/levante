import { parseModelRef, isQualifiedModelRef, getRawModelId } from '../../../shared/modelRefs'
import { platformService } from '../platformService'
import { userProfileService } from '../userProfileService'
import { getLogger } from '../logging'
import type { ProviderConfig, ProviderType } from '../../../types/models'

const logger = getLogger()

export type ResolvedModelTarget =
  | {
      source: 'platform'
      providerId: 'levante-platform'
      providerType: 'levante-platform'
      rawModelId: string
      storedModelRef: string
    }
  | {
      source: 'provider'
      providerId: string
      providerType: ProviderType
      rawModelId: string
      storedModelRef: string
      provider: ProviderConfig
    }

async function getProviders(): Promise<ProviderConfig[]> {
  const { preferencesService } = await import('../preferencesService')
  return (preferencesService.get('providers') as ProviderConfig[]) || []
}

async function getUseOtherProviders(): Promise<boolean> {
  const { preferencesService } = await import('../preferencesService')
  return (preferencesService.get('useOtherProviders') as boolean) ?? false
}

function findProviderForModel(providers: ProviderConfig[], modelId: string): ProviderConfig | undefined {
  return providers.find((provider) => {
    if (provider.modelSource === 'dynamic') {
      return provider.selectedModelIds?.includes(modelId)
    } else {
      return provider.models.some((m) => m.id === modelId && m.isSelected !== false)
    }
  })
}

function isPlatformModel(rawModelId: string): boolean {
  const allowedModels = platformService.getAllowedModels()
  return allowedModels.includes(rawModelId)
}

async function validatePlatformAuth(): Promise<void> {
  const isAuth = await platformService.isAuthenticated()
  if (!isAuth) {
    throw new Error('Levante Platform session expired. Please log in again.')
  }
}

export async function resolveModelTarget(modelRef: string): Promise<ResolvedModelTarget> {
  const profile = await userProfileService.getProfile()
  const appMode = profile.appMode

  // Case A: Qualified reference
  if (isQualifiedModelRef(modelRef)) {
    const parsed = parseModelRef(modelRef)!
    const { providerId, modelId: rawModelId } = parsed

    if (providerId === 'levante-platform') {
      // Validate platform auth
      await validatePlatformAuth()

      // Validate model belongs to platform (refresh cache if needed)
      if (!isPlatformModel(rawModelId)) {
        await platformService.getStatus()
        if (!isPlatformModel(rawModelId)) {
          throw new Error(
            `Model "${rawModelId}" is not available in your Levante Platform plan.`
          )
        }
      }

      return {
        source: 'platform',
        providerId: 'levante-platform',
        providerType: 'levante-platform',
        rawModelId,
        storedModelRef: modelRef,
      }
    }

    // Standalone provider qualified ref
    const providers = await getProviders()
    const provider = providers.find((p) => p.id === providerId)

    if (!provider) {
      throw new Error(
        `Provider "${providerId}" not found. Please configure it in the Models page.`
      )
    }

    // Validate model belongs to this provider
    const modelFound = provider.modelSource === 'dynamic'
      ? provider.selectedModelIds?.includes(rawModelId)
      : provider.models.some((m) => m.id === rawModelId && m.isSelected !== false)

    if (!modelFound) {
      throw new Error(
        `Model "${rawModelId}" not found in provider "${provider.name}". Please enable it in the Models page.`
      )
    }

    return {
      source: 'provider',
      providerId: provider.id,
      providerType: provider.type,
      rawModelId,
      storedModelRef: modelRef,
      provider,
    }
  }

  // Case B: Legacy raw value in standalone
  if (appMode !== 'platform') {
    const providers = await getProviders()
    const provider = findProviderForModel(providers, modelRef)

    if (!provider) {
      throw new Error(
        `Model "${modelRef}" not found in any configured provider. Please select the model in the Models page.`
      )
    }

    return {
      source: 'provider',
      providerId: provider.id,
      providerType: provider.type,
      rawModelId: modelRef,
      storedModelRef: modelRef,
      provider,
    }
  }

  // Platform mode with raw value
  const useOtherProviders = await getUseOtherProviders()

  // Case C: Legacy raw in platform pure
  if (!useOtherProviders) {
    await validatePlatformAuth()

    if (!isPlatformModel(modelRef)) {
      await platformService.getStatus()
      if (!isPlatformModel(modelRef)) {
        throw new Error(
          `Model "${modelRef}" is not available in your Levante Platform plan.`
        )
      }
    }

    return {
      source: 'platform',
      providerId: 'levante-platform',
      providerType: 'levante-platform',
      rawModelId: modelRef,
      storedModelRef: modelRef,
    }
  }

  // Case D: Legacy raw in platform hybrid
  const providers = await getProviders()
  const standaloneMatches = providers.filter((p) => {
    if (p.modelSource === 'dynamic') {
      return p.selectedModelIds?.includes(modelRef)
    } else {
      return p.models.some((m) => m.id === modelRef && m.isSelected !== false)
    }
  })

  const isInPlatform = isPlatformModel(modelRef)

  if (isInPlatform) {
    // Platform has priority, but we need auth
    const isAuth = await platformService.isAuthenticated()
    if (isAuth) {
      return {
        source: 'platform',
        providerId: 'levante-platform',
        providerType: 'levante-platform',
        rawModelId: modelRef,
        storedModelRef: modelRef,
      }
    }

    // Platform auth expired but model exists in standalone too
    if (standaloneMatches.length === 1) {
      logger.aiSdk.warn('Platform auth expired, falling back to standalone provider', {
        modelId: modelRef,
        providerId: standaloneMatches[0].id,
      })
      return {
        source: 'provider',
        providerId: standaloneMatches[0].id,
        providerType: standaloneMatches[0].type,
        rawModelId: modelRef,
        storedModelRef: modelRef,
        provider: standaloneMatches[0],
      }
    }

    throw new Error('Levante Platform session expired. Please log in again.')
  }

  // Not in platform
  if (standaloneMatches.length === 1) {
    return {
      source: 'provider',
      providerId: standaloneMatches[0].id,
      providerType: standaloneMatches[0].type,
      rawModelId: modelRef,
      storedModelRef: modelRef,
      provider: standaloneMatches[0],
    }
  }

  if (standaloneMatches.length > 1) {
    throw new Error(
      `Model "${modelRef}" found in multiple providers (${standaloneMatches.map((p) => p.name).join(', ')}). ` +
      `Please re-select the model in the chat to disambiguate.`
    )
  }

  // Not found anywhere
  throw new Error(
    `Model "${modelRef}" not found in any configured source. Please select a valid model.`
  )
}

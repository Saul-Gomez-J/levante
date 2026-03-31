export const MODEL_REF_SEPARATOR = '::'

export function buildModelRef(providerId: string, modelId: string): string {
  return `${encodeURIComponent(providerId)}${MODEL_REF_SEPARATOR}${encodeURIComponent(modelId)}`
}

export function parseModelRef(value: string): { providerId: string; modelId: string } | null {
  const idx = value.indexOf(MODEL_REF_SEPARATOR)
  if (idx === -1) return null
  const providerId = decodeURIComponent(value.slice(0, idx))
  const modelId = decodeURIComponent(value.slice(idx + MODEL_REF_SEPARATOR.length))
  if (!providerId || !modelId) return null
  return { providerId, modelId }
}

export function isQualifiedModelRef(value: string): boolean {
  return value.includes(MODEL_REF_SEPARATOR)
}

export function getRawModelId(value: string): string {
  const parsed = parseModelRef(value)
  return parsed ? parsed.modelId : value
}

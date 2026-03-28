import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPathTail(filePath: string, segmentCount = 2): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const hasLeadingSlash = normalized.startsWith('/')
  const segments = normalized.split('/').filter(Boolean)

  if (segments.length === 0) return filePath
  if (segments.length <= segmentCount) {
    return `${hasLeadingSlash ? '/' : ''}${segments.join('/')}`
  }

  return `.../${segments.slice(-segmentCount).join('/')}`
}

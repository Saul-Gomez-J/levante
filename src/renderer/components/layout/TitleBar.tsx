/**
 * Custom Title Bar Component
 *
 * Provides a draggable title bar for the application window
 * with native window controls on Windows/Linux and traffic lights on macOS
 */

import React from 'react'
import { cn } from '@/lib/utils'
import { WindowControls } from './WindowControls'

interface TitleBarProps {
  title?: string
  className?: string
  showTitle?: boolean
  children?: React.ReactNode
}

export function TitleBar({ title, className, showTitle = false, children }: TitleBarProps) {
  // Get platform for conditional styling
  const [platform, setPlatform] = React.useState<string>('')

  React.useEffect(() => {
    const loadPlatform = async () => {
      try {
        const appPlatform = await window.levante.getPlatform()
        setPlatform(appPlatform)
      } catch (error) {
        console.error('Failed to get platform:', error)
      }
    }

    loadPlatform()
  }, [])

  const isMac = platform === 'darwin'
  const isWindows = platform === 'win32'
  const isLinux = platform === 'linux'

  return (
    <div
      className={cn(
        'title-bar',
        'flex items-center h-12 px-2 shrink-0',
        'bg-background border-b border-border',
        className
      )}
      style={{
        WebkitAppRegion: 'drag',
        userSelect: 'none'
      } as React.CSSProperties}
    >
      {/* Left side - Custom content with platform-specific spacing */}
      <div
        className={cn(
          'flex items-center gap-2',
          isMac && 'ml-16', // Space for macOS traffic lights
          (isWindows || isLinux) && children && 'ml-2' // Small margin for Windows/Linux
        )}
      >
        {/* Custom content on the left (like sidebar trigger, buttons) */}
        {children && (
          <div
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="flex items-center gap-2"
          >
            {children}
          </div>
        )}
      </div>

      {/* Center - Title (when sidebar has content, shift to compensate) */}
      {showTitle && title && (
        <div className={cn('flex-1 text-center', !children && isMac && 'ml-16')}>
          <h1 className="text-sm font-medium text-muted-foreground truncate px-4">
            {title}
          </h1>
        </div>
      )}

      {/* Right side - Window controls for Windows (frameless) */}
      <div
        className="flex items-center h-full ml-auto"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <WindowControls />
      </div>
    </div>
  )
}

/**
 * Window Controls Component
 *
 * Custom window controls (minimize, maximize/restore, close) for frameless windows
 * Only shown on Windows platform
 */

import React from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function WindowControls() {
  const [platform, setPlatform] = React.useState<string>('')
  const [isMaximized, setIsMaximized] = React.useState(false)

  React.useEffect(() => {
    const loadPlatform = async () => {
      try {
        const appPlatform = await window.levante.getPlatform()
        console.log('[WindowControls] Platform detected:', appPlatform)
        setPlatform(appPlatform)
      } catch (error) {
        console.error('[WindowControls] Failed to get platform:', error)
      }
    }

    loadPlatform()
  }, [])

  React.useEffect(() => {
    // Check initial maximize state
    const checkMaximizeState = async () => {
      try {
        const result = await window.levante.window.isMaximized()
        if (result.success && result.data !== undefined) {
          setIsMaximized(result.data)
        }
      } catch (error) {
        console.error('Failed to check maximize state:', error)
      }
    }

    checkMaximizeState()

    // Listen for maximize state changes
    const cleanup = window.levante.window.onMaximizeChanged((maximized) => {
      setIsMaximized(maximized)
    })

    return cleanup
  }, [])

  // Show controls on Windows and Linux (frameless), not on macOS (has traffic lights)
  // While loading, don't show anything (will flash on macOS otherwise)
  if (!platform) {
    return null
  }

  const isMac = platform === 'darwin'

  if (isMac) {
    console.log('[WindowControls] Not showing controls on macOS (has traffic lights)')
    return null
  }

  console.log('[WindowControls] Rendering controls for', platform)

  const handleMinimize = async () => {
    try {
      await window.levante.window.minimize()
    } catch (error) {
      console.error('Failed to minimize window:', error)
    }
  }

  const handleMaximize = async () => {
    try {
      await window.levante.window.maximize()
    } catch (error) {
      console.error('Failed to maximize/restore window:', error)
    }
  }

  const handleClose = async () => {
    try {
      await window.levante.window.close()
    } catch (error) {
      console.error('Failed to close window:', error)
    }
  }

  return (
    <div className="flex items-center h-full">
      {/* Minimize */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleMinimize}
        className={cn(
          'h-full w-12 rounded-none',
          'hover:bg-accent/50 active:bg-accent',
          'transition-colors'
        )}
        title="Minimize"
      >
        <Minus className="h-4 w-4" />
      </Button>

      {/* Maximize/Restore */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleMaximize}
        className={cn(
          'h-full w-12 rounded-none',
          'hover:bg-accent/50 active:bg-accent',
          'transition-colors'
        )}
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <Copy className="h-3.5 w-3.5" />
        ) : (
          <Square className="h-3.5 w-3.5" />
        )}
      </Button>

      {/* Close */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleClose}
        className={cn(
          'h-full w-12 rounded-none',
          'hover:bg-destructive hover:text-destructive-foreground',
          'active:bg-destructive/90',
          'transition-colors'
        )}
        title="Close"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}

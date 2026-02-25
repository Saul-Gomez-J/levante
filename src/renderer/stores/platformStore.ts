/**
 * PlatformStore - Central source of truth for Levante Platform mode
 *
 * Manages:
 * - App mode (platform vs standalone)
 * - Platform authentication state
 * - User info from JWT
 * - Allowed models from JWT + metadata from API
 */

import { create } from 'zustand';
import type { AppMode, PlatformUser, PlatformStatus } from '../../types/userProfile';
import type { Model } from '../../types/models';
import { getRendererLogger } from '@/services/logger';

const logger = getRendererLogger();

interface PlatformState {
  // State
  appMode: AppMode | null;
  isAuthenticated: boolean;
  user: PlatformUser | null;
  allowedModels: string[];
  models: Model[];
  isLoading: boolean;
  error: string | null;

  // Actions
  initialize: () => Promise<void>;
  login: (baseUrl?: string) => Promise<void>;
  logout: () => Promise<void>;
  setStandaloneMode: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  fetchModels: () => Promise<void>;
}

export const usePlatformStore = create<PlatformState>((set, get) => ({
  // Initial state
  appMode: null,
  isAuthenticated: false,
  user: null,
  allowedModels: [],
  models: [],
  isLoading: false,
  error: null,

  /**
   * Initialize: check stored mode and token status on boot
   */
  initialize: async () => {
    try {
      set({ isLoading: true, error: null });

      // Read appMode from user profile
      const profileResult = await window.levante.profile.get();
      const appMode = profileResult.data?.appMode || null;

      if (appMode === 'platform') {
        // Verify tokens are still valid
        const statusResult = await window.levante.platform.getStatus();

        if (statusResult.success && statusResult.data?.isAuthenticated) {
          set({
            appMode: 'platform',
            isAuthenticated: true,
            user: statusResult.data.user,
            allowedModels: statusResult.data.allowedModels,
          });

          // Fetch full model metadata in background
          get().fetchModels();
        } else {
          // Tokens expired/invalid, keep platform mode but mark as unauthenticated
          set({
            appMode: 'platform',
            isAuthenticated: false,
            user: null,
            allowedModels: [],
            models: [],
          });
        }
      } else if (appMode === 'standalone') {
        set({ appMode: 'standalone', isAuthenticated: false });
      }
      // If null, mode not yet chosen (first run)
    } catch (error) {
      logger.core.error( 'Failed to initialize platform store', {
        error: error instanceof Error ? error.message : error,
      });
      set({ error: error instanceof Error ? error.message : 'Initialization failed' });
    } finally {
      set({ isLoading: false });
    }
  },

  /**
   * Login to Levante Platform via OAuth
   */
  login: async (baseUrl?: string) => {
    try {
      set({ isLoading: true, error: null });

      const result = await window.levante.platform.login(baseUrl);

      if (!result.success) {
        throw new Error(result.error || 'Login failed');
      }

      const status = result.data as PlatformStatus;

      set({
        appMode: 'platform',
        isAuthenticated: true,
        user: status.user,
        allowedModels: status.allowedModels,
      });

      // Fetch full model metadata
      await get().fetchModels();
    } catch (error) {
      logger.core.error( 'Platform login failed', {
        error: error instanceof Error ? error.message : error,
      });
      set({ error: error instanceof Error ? error.message : 'Login failed' });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  /**
   * Logout from Levante Platform
   */
  logout: async () => {
    try {
      set({ isLoading: true, error: null });

      await window.levante.platform.logout();

      set({
        appMode: 'standalone',
        isAuthenticated: false,
        user: null,
        allowedModels: [],
        models: [],
      });
    } catch (error) {
      logger.core.error( 'Platform logout failed', {
        error: error instanceof Error ? error.message : error,
      });
      set({ error: error instanceof Error ? error.message : 'Logout failed' });
    } finally {
      set({ isLoading: false });
    }
  },

  /**
   * Set standalone mode (user chose "Use own API keys")
   */
  setStandaloneMode: async () => {
    try {
      await window.levante.profile.update({ appMode: 'standalone' });
      set({
        appMode: 'standalone',
        isAuthenticated: false,
        user: null,
        allowedModels: [],
        models: [],
      });
    } catch (error) {
      logger.core.error( 'Failed to set standalone mode', {
        error: error instanceof Error ? error.message : error,
      });
    }
  },

  /**
   * Refresh platform status (re-check tokens, re-decode JWT)
   */
  refreshStatus: async () => {
    try {
      const result = await window.levante.platform.getStatus();

      if (result.success && result.data) {
        set({
          isAuthenticated: result.data.isAuthenticated,
          user: result.data.user,
          allowedModels: result.data.allowedModels,
        });
      }
    } catch (error) {
      logger.core.error( 'Failed to refresh platform status', {
        error: error instanceof Error ? error.message : error,
      });
    }
  },

  /**
   * Fetch full model metadata from /api/v1/models
   */
  fetchModels: async () => {
    try {
      const result = await window.levante.platform.getModels();

      if (result.success && result.data) {
        const models: Model[] = result.data.map((raw: any) => ({
          id: raw.id,
          name: raw.name || raw.id,
          provider: 'levante-platform',
          contextLength: raw.context_length || raw.contextLength || 128000,
          pricing: raw.pricing
            ? {
                input: parseFloat(raw.pricing.prompt || raw.pricing.input || '0'),
                output: parseFloat(raw.pricing.completion || raw.pricing.output || '0'),
              }
            : undefined,
          description: raw.description,
          category: raw.category,
          capabilities: raw.capabilities || [],
          isAvailable: true,
          userDefined: false,
        }));

        set({ models });
      }
    } catch (error) {
      logger.core.error( 'Failed to fetch platform models', {
        error: error instanceof Error ? error.message : error,
      });
    }
  },
}));

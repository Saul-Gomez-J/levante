import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { WizardStep } from '@/components/onboarding/WizardStep';
import { WelcomeStep } from '@/components/onboarding/WelcomeStep';
import { ModeSelectionStep } from '@/components/onboarding/ModeSelectionStep';
import { ProviderStep } from '@/components/onboarding/ProviderStep';
import { DirectoryStep } from '@/components/onboarding/DirectoryStep';
import { CompletionStep } from '@/components/onboarding/CompletionStep';
import { useModelStore, getModelStoreState } from '@/stores/modelStore';
import { usePlatformStore } from '@/stores/platformStore';
import { detectSystemLanguage } from '@/i18n/languageDetector';
import type { ProviderValidationConfig } from '../../types/wizard';

/**
 * Wizard steps differ by mode:
 * - Platform: Welcome → ModeSelection → Directory → Completion (4 steps, skip ProviderStep)
 * - Standalone: Welcome → ModeSelection → Provider → Directory → Completion (5 steps)
 * - Before mode is chosen: TOTAL_STEPS = 4 (platform path, shorter)
 */
const PLATFORM_TOTAL_STEPS = 4;
const STANDALONE_TOTAL_STEPS = 5;

const PROVIDER_NAMES: Record<string, string> = {
  openrouter: 'OpenRouter',
  'vercel-gateway': 'Vercel AI Gateway',
  local: 'Local Server',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google AI',
};

// Map provider IDs to validation types (some providers have different IDs for storage vs validation)
const PROVIDER_ID_TO_VALIDATION_TYPE: Record<string, string> = {
  'vercel-gateway': 'gateway', // Storage ID → Validation type
  openrouter: 'openrouter',
  local: 'local',
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
};

interface OnboardingWizardProps {
  onComplete?: () => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps = {}) {
  const { updateProvider, setActiveProvider, syncProviderModels, providers } = useModelStore();
  const { appMode, isAuthenticated: isPlatformConnected, setStandaloneMode } = usePlatformStore();
  const { t, i18n } = useTranslation();
  const userChangedLanguageRef = useRef(false);

  // Language step state
  const [detectedLanguage, setDetectedLanguage] = useState<'en' | 'es'>('en');
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'es'>('en');

  // Mode selection state
  const [chosenMode, setChosenMode] = useState<'platform' | 'standalone' | null>(null);

  // Wizard state
  const [currentStep, setCurrentStep] = useState(1);

  // Total steps depends on chosen mode
  const totalSteps = chosenMode === 'standalone' ? STANDALONE_TOTAL_STEPS : PLATFORM_TOTAL_STEPS;

  // Provider step state
  const [selectedProvider, setSelectedProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('http://localhost:11434');
  const [validationStatus, setValidationStatus] = useState<
    'idle' | 'validating' | 'valid' | 'invalid'
  >('idle');
  const [validationError, setValidationError] = useState('');

  // Model selection state
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  // Analytics consent state (null = not selected yet)
  const [analyticsConsent, setAnalyticsConsent] = useState<boolean | null>(null);

  // Detect language on mount: prefer stored preference, else system
  useEffect(() => {
    const initializeLanguage = async () => {
      const detected = detectSystemLanguage();
      setDetectedLanguage(detected);

      try {
        const prefResult = await window.levante.preferences.get('language');
        const prefLanguage = prefResult?.data;
        const initialLanguage = prefLanguage === 'es' || prefLanguage === 'en' ? prefLanguage : detected;

        // Do not override if the user already interacted very quickly
        if (!userChangedLanguageRef.current) {
          setSelectedLanguage(initialLanguage);
          i18n.changeLanguage(initialLanguage);
        }
      } catch (error) {
        console.error('Failed to load preferred language, falling back to detected:', error);
        if (!userChangedLanguageRef.current) {
          setSelectedLanguage(detected);
          i18n.changeLanguage(detected);
        }
      }
    };

    initializeLanguage();
  }, [i18n]);

  // Load models when providers change (after sync)
  useEffect(() => {
    if (selectedProvider && validationStatus === 'valid') {
      // Small delay to ensure store is updated after sync
      const timer = setTimeout(() => {
        loadAvailableModels();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [providers, selectedProvider, validationStatus]);

  // Load existing analytics consent on mount
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const profile = await window.levante.profile.get();
        if (profile.success && profile.data?.analytics) {
          // Only set if there's an existing value, otherwise keep null
          if (profile.data.analytics.consentedAt) {
            setAnalyticsConsent(profile.data.analytics.hasConsented);
          }
        }
      } catch (error) {
        console.error('Failed to load profile:', error);
      }
    };

    loadProfile();
  }, []);

  /**
   * Get the logical step name for the current step number based on mode.
   *
   * Platform flow:   1=Welcome, 2=ModeSelection, 3=Directory, 4=Completion
   * Standalone flow: 1=Welcome, 2=ModeSelection, 3=Provider, 4=Directory, 5=Completion
   */
  const getStepName = (step: number): string => {
    if (step === 1) return 'welcome';
    if (step === 2) return 'modeSelection';
    if (chosenMode === 'standalone') {
      if (step === 3) return 'provider';
      if (step === 4) return 'directory';
      if (step === 5) return 'completion';
    } else {
      // Platform mode (or mode not yet chosen)
      if (step === 3) return 'directory';
      if (step === 4) return 'completion';
    }
    return 'unknown';
  };

  const currentStepName = getStepName(currentStep);

  const handleNext = async () => {
    // Step 1 (Welcome): Save language selection and start wizard
    if (currentStepName === 'welcome') {
      try {
        await window.levante.preferences.set('language', selectedLanguage);
        i18n.changeLanguage(selectedLanguage);
        await window.levante.wizard.start();
      } catch (error) {
        console.error('Failed to save language or start wizard:', error);
      }
    }

    // Step: ModeSelection - handled by callbacks, not by Next button
    if (currentStepName === 'modeSelection') {
      // Should not reach here normally - mode selection advances via callbacks
      return;
    }

    // Provider step: Must validate before proceeding
    if (currentStepName === 'provider' && validationStatus !== 'valid') {
      return;
    }

    // Directory step: Save analytics consent
    if (currentStepName === 'directory' && analyticsConsent !== null) {
      try {
        // Always generate UUID if it doesn't exist (regardless of consent choice)
        const profile = await window.levante.profile.get();
        const existingId = profile.data?.analytics?.anonymousUserId;
        const anonymousUserId = existingId || crypto.randomUUID();

        // Save analytics consent to user profile
        await window.levante.profile.update({
          analytics: {
            hasConsented: analyticsConsent,
            consentedAt: new Date().toISOString(),
            anonymousUserId: anonymousUserId,
          },
        });

        // Track analytics asynchronously (fire-and-forget, don't block UI flow)
        console.log('[Onboarding] Tracking user analytics in background...', { hasConsented: analyticsConsent });
        window.levante.analytics?.trackUser?.()
          .then(() => {
            console.log('[Onboarding] User tracked successfully');
            return window.levante.analytics?.trackAppOpen?.(true);
          })
          .then(() => {
            console.log('[Onboarding] Initial app open tracked');
          })
          .catch((e) => {
            console.error('[Onboarding] Failed to track user/app open', e);
          });
      } catch (error) {
        console.error('Failed to save analytics consent:', error);
      }
    }

    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    } else {
      // Complete wizard and navigate to chat
      await handleComplete();
    }
  };

  const handleLanguageChange = (language: 'en' | 'es') => {
    userChangedLanguageRef.current = true;
    setSelectedLanguage(language);
    i18n.changeLanguage(language);
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);
    setApiKey('');
    setEndpoint(
      provider === 'local' ? 'http://localhost:11434' : ''
    );
    setValidationStatus('idle');
    setValidationError('');
    setAvailableModels([]);
    setSelectedModel(null);
  };

  const handleModelSelect = async (modelId: string) => {
    setSelectedModel(modelId);
    // Mark this model as selected in the provider configuration
    try {
      await updateProvider(selectedProvider, {
        selectedModelIds: [modelId]
      });
    } catch (error) {
      console.error('Failed to select model:', error);
    }
  };

  const handleValidateProvider = async () => {
    if (!selectedProvider) return;

    setValidationStatus('validating');
    setValidationError('');

    try {
      // Map provider ID to validation type
      const validationType = PROVIDER_ID_TO_VALIDATION_TYPE[selectedProvider] || selectedProvider;

      const config: ProviderValidationConfig = {
        type: validationType as any,
        apiKey: apiKey || undefined,
        endpoint: endpoint || undefined,
      };

      const result = await window.levante.wizard.validateProvider(config);

      if (result.success && result.data?.isValid) {
        setValidationStatus('valid');
        setValidationError('');

        // Save provider configuration
        await saveProviderConfig();
      } else {
        setValidationStatus('invalid');
        setValidationError(
          result.data?.error ||
          result.error ||
          'Validation failed. Please check your credentials.'
        );
      }
    } catch (error) {
      setValidationStatus('invalid');
      setValidationError(
        error instanceof Error ? error.message : 'Unknown error occurred'
      );
    }
  };

  const saveProviderConfig = async () => {
    try {
      // Build update object based on provider type
      const updates: any = {};

      if (apiKey) {
        updates.apiKey = apiKey;
      }

      // Only add endpoint for specific providers
      if (selectedProvider === 'local') {
        updates.baseUrl = endpoint;
      } else if (selectedProvider === 'vercel-gateway') {
        // Use provided endpoint or default
        updates.baseUrl = endpoint || 'https://ai-gateway.vercel.sh/v1';
      }

      // Update provider with API key/endpoint if we have updates
      if (Object.keys(updates).length > 0) {
        await updateProvider(selectedProvider, updates);
      }

      // Set as active provider
      await setActiveProvider(selectedProvider);

      // Sync models from provider
      await syncProviderModels(selectedProvider);

      // Wait a bit for store to update, then load available models
      setTimeout(() => {
        loadAvailableModels();
      }, 200);
    } catch (error) {
      console.error('Failed to save provider config:', error);
    }
  };

  const loadAvailableModels = () => {
    try {
      // Get provider from store (which is already updated after sync)
      const provider = providers.find((p) => p.id === selectedProvider);
      if (provider && provider.models) {
        // Filter only available models
        const models = provider.models.filter((m) => m.isAvailable);
        setAvailableModels(models);
        console.log('Loaded available models:', models.length);
      } else {
        console.log('No provider or models found', { provider: !!provider, models: provider?.models?.length });
      }
    } catch (error) {
      console.error('Failed to load available models:', error);
    }
  };

  const handleOAuthSuccess = async (newApiKey: string) => {
    console.log('OAuth success - starting provider configuration', {
      provider: selectedProvider,
      keyPrefix: newApiKey.substring(0, 10) + '...'
    });

    // Update state immediately
    setApiKey(newApiKey);
    setValidationStatus('validating');
    setValidationError('');

    try {
      // Map provider ID to validation type
      const validationType = PROVIDER_ID_TO_VALIDATION_TYPE[selectedProvider] || selectedProvider;

      const config: ProviderValidationConfig = {
        type: validationType as any,
        apiKey: newApiKey,
        endpoint: endpoint || undefined,
      };

      console.log('Validating OAuth credentials...');
      const result = await window.levante.wizard.validateProvider(config);

      if (!result.success || !result.data?.isValid) {
        setValidationStatus('invalid');
        setValidationError(
          result.data?.error ||
          result.error ||
          'OAuth validation failed'
        );
        console.error('OAuth validation failed', result);
        return;
      }

      console.log('OAuth validation successful, configuring provider...');
      setValidationStatus('valid');
      setValidationError('');

      // Save provider configuration
      const updates: any = { apiKey: newApiKey };

      // Only add endpoint for specific providers
      if (selectedProvider === 'local') {
        updates.baseUrl = endpoint;
      } else if (selectedProvider === 'vercel-gateway') {
        updates.baseUrl = endpoint || 'https://ai-gateway.vercel.sh/v1';
      }

      // Update provider configuration
      console.log('Updating provider configuration...');
      await updateProvider(selectedProvider, updates);

      // Set as active provider
      console.log('Setting active provider...');
      await setActiveProvider(selectedProvider);

      // Sync models from provider API
      console.log('Syncing models from provider...');
      await syncProviderModels(selectedProvider);

      // Force immediate refresh after sync completes
      console.log('Sync complete, loading models into UI...');

      // Poll for models with retry mechanism
      // This is necessary because Zustand updates are async
      const pollForModels = async (): Promise<void> => {
        const maxAttempts = 10;
        const pollInterval = 300; // Check every 300ms

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          // Get fresh provider data from store
          const currentProviders = getModelStoreState().providers;
          const provider = currentProviders.find((p: any) => p.id === selectedProvider);

          console.log(`📡 Polling for models (attempt ${attempt}/${maxAttempts})`, {
            hasProvider: !!provider,
            modelCount: provider?.models?.length || 0
          });

          if (provider?.models && provider.models.length > 0) {
            const availableModels = provider.models.filter((m: any) => m.isAvailable);
            setAvailableModels(availableModels);
            console.log('✅ Models loaded successfully:', availableModels.length);
            return; // Success!
          }

          // Wait before next attempt
          if (attempt < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
          }
        }

        // If we get here, polling failed
        console.error('❌ Failed to load models after', maxAttempts, 'attempts');
        console.log('Forcing final load attempt from providers state...');
        loadAvailableModels();
      };

      // Start polling
      pollForModels().catch(error => {
        console.error('Polling error:', error);
        loadAvailableModels();
      });

    } catch (error) {
      console.error('OAuth configuration error:', error);
      setValidationStatus('invalid');
      setValidationError(
        error instanceof Error ? error.message : 'Unknown error occurred'
      );
    }
  };

  const handleSubscriptionOAuthSuccess = async (providerId: 'anthropic' | 'openai') => {
    console.log('Subscription OAuth success - configuring provider', { providerId });

    setValidationStatus('valid');
    setValidationError('');

    try {
      await updateProvider(providerId, { authMode: 'oauth', apiKey: undefined });
      await setActiveProvider(providerId);
      await syncProviderModels(providerId);

      const maxAttempts = 10;
      const pollInterval = 300;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const currentProviders = getModelStoreState().providers;
        const provider = currentProviders.find((p: any) => p.id === providerId);

        if (provider?.models && provider.models.length > 0) {
          const models = provider.models.filter((m: any) => m.isAvailable);
          setAvailableModels(models);
          console.log('Subscription OAuth models loaded:', {
            providerId,
            count: models.length,
          });
          return;
        }

        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
      }

      loadAvailableModels();
    } catch (error) {
      console.error('Subscription OAuth configuration error:', error);
      setValidationStatus('invalid');
      setValidationError(
        error instanceof Error ? error.message : 'Unknown error occurred'
      );
    }
  };

  const handlePlatformLoginSuccess = () => {
    setChosenMode('platform');
    // Auto-advance past mode selection step
    setCurrentStep(3); // Goes to MCP step in platform flow
  };

  const handleStandaloneSelect = async () => {
    setChosenMode('standalone');
    await setStandaloneMode();
    // Auto-advance past mode selection step
    setCurrentStep(3); // Goes to Provider step in standalone flow
  };

  const handleComplete = async () => {
    try {
      // Complete wizard
      const provider = chosenMode === 'platform' ? 'levante-platform' : selectedProvider;
      await window.levante.wizard.complete({
        provider,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      });

      // Call onComplete callback to reload app
      if (onComplete) {
        onComplete();
      } else {
        // Fallback: reload window
        window.location.reload();
      }
    } catch (error) {
      console.error('Failed to complete wizard:', error);
    }
  };

  const getNextButtonLabel = () => {
    if (currentStep === totalSteps) {
      return t('wizard:navigation.start_using_levante');
    }
    return t('common:actions.next');
  };

  const isNextDisabled = () => {
    // Mode selection step: handled by callbacks, Next button not shown
    if (currentStepName === 'modeSelection') {
      return true;
    }
    // Provider step: requires validation and model selection
    if (currentStepName === 'provider') {
      return !selectedProvider || validationStatus !== 'valid' || !selectedModel;
    }
    // Directory step: requires analytics consent selection
    if (currentStepName === 'directory') {
      return analyticsConsent === null;
    }
    return false;
  };

  return (
    <WizardStep
      currentStep={currentStep}
      totalSteps={totalSteps}
      onNext={handleNext}
      onBack={handleBack}
      nextLabel={getNextButtonLabel()}
      nextDisabled={isNextDisabled()}
      showNextChevron={currentStep !== totalSteps}
    >
      {currentStepName === 'welcome' && (
        <WelcomeStep
          selectedLanguage={selectedLanguage}
          detectedLanguage={detectedLanguage}
          onLanguageChange={handleLanguageChange}
        />
      )}
      {currentStepName === 'modeSelection' && (
        <ModeSelectionStep
          onPlatformLogin={handlePlatformLoginSuccess}
          onStandaloneSelect={handleStandaloneSelect}
          isPlatformConnected={isPlatformConnected}
        />
      )}
      {currentStepName === 'provider' && (
        <ProviderStep
          selectedProvider={selectedProvider}
          apiKey={apiKey}
          endpoint={endpoint}
          validationStatus={validationStatus}
          validationError={validationError}
          availableModels={availableModels}
          selectedModel={selectedModel}
          onProviderChange={handleProviderChange}
          onApiKeyChange={setApiKey}
          onEndpointChange={setEndpoint}
          onValidate={handleValidateProvider}
          onModelSelect={handleModelSelect}
          onOAuthSuccess={handleOAuthSuccess}
          onSubscriptionOAuthSuccess={handleSubscriptionOAuthSuccess}
        />
      )}
      {currentStepName === 'directory' && (
        <DirectoryStep
          analyticsConsent={analyticsConsent}
          onAnalyticsConsentChange={setAnalyticsConsent}
        />
      )}
      {currentStepName === 'completion' && (
        <CompletionStep
          providerName={
            chosenMode === 'platform'
              ? 'Levante Platform'
              : PROVIDER_NAMES[selectedProvider] || selectedProvider
          }
          appMode={chosenMode === 'platform' ? 'platform' : 'standalone'}
        />
      )}
    </WizardStep>
  );
}

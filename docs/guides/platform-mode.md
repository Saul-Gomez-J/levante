# Platform Mode

Levante operates in two mutually exclusive modes:

- **Platform Mode**: User authenticates via OAuth with Levante Platform. Models are determined by the user's plan (JWT `allowed_models` claim). No API keys needed.
- **Standalone Mode**: User configures their own providers and API keys (OpenRouter, OpenAI, Anthropic, etc.).

The mode is chosen during onboarding and persisted in `user-profile.json` as `appMode`. Users can also switch modes at runtime: logging out of platform switches to standalone, and signing in from the Models page switches to platform.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Renderer Process                       │
│                                                             │
│  ┌─────────────────┐    ┌──────────────────────────────┐    │
│  │ usePlatformStore │    │ useModelSelection            │    │
│  │ (Zustand)        │◄───│ (branches on appMode)        │    │
│  │                  │    │                              │    │
│  │ • appMode        │    │ platform → platformStore     │    │
│  │ • isAuthenticated│    │ standalone → modelService    │    │
│  │ • user           │    └──────────────────────────────┘    │
│  │ • models[]       │                                        │
│  └────────┬─────────┘                                        │
│           │ IPC (levante/platform/*)                         │
├───────────┼─────────────────────────────────────────────────┤
│           ▼            Main Process                          │
│  ┌─────────────────┐    ┌──────────────────────────────┐    │
│  │ PlatformService  │───►│ OAuthService                 │    │
│  │ (singleton)      │    │ (token storage, refresh,     │    │
│  │                  │    │  PKCE, DCR)                  │    │
│  │ • login()        │    └──────────────────────────────┘    │
│  │ • logout()       │                                        │
│  │ • getStatus()    │    ┌──────────────────────────────┐    │
│  │ • getAccessToken │───►│ jwt-decode                   │    │
│  │ • fetchModels()  │    │ (extract claims, no verify)  │    │
│  └──────────────────┘    └──────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Key Files

| File | Layer | Purpose |
|---|---|---|
| `src/types/userProfile.ts` | Shared | `AppMode`, `PlatformUser`, `PlatformStatus` types |
| `src/main/services/platformService.ts` | Main | Core service: OAuth flow, JWT decode, model fetch |
| `src/main/ipc/platformHandlers.ts` | Main | IPC handlers (`levante/platform/*`) |
| `src/preload/api/platform.ts` | Preload | Bridge: `window.levante.platform.*` |
| `src/renderer/stores/platformStore.ts` | Renderer | Zustand store: app mode, auth state, models |
| `src/renderer/hooks/useModelSelection.ts` | Renderer | Branches model loading by appMode |
| `src/renderer/pages/AccountPage.tsx` | Renderer | Platform-only account page (with logout confirmation) |
| `src/renderer/pages/ModelPage.tsx` | Renderer | Models page (includes platform sign-in card in standalone mode) |
| `src/renderer/components/onboarding/ModeSelectionStep.tsx` | Renderer | Onboarding: choose platform vs standalone |
| `src/renderer/components/onboarding/CompletionStep.tsx` | Renderer | Onboarding completion (branches by appMode) |
| `src/main/services/ai/providerResolver.ts` | Main | Routes to platform in platform mode |

## IPC Channels

| Channel | Preload method | Description |
|---|---|---|
| `levante/platform/login` | `window.levante.platform.login(baseUrl?)` | OAuth flow → returns `PlatformStatus` |
| `levante/platform/logout` | `window.levante.platform.logout()` | Revoke tokens, set appMode to standalone |
| `levante/platform/status` | `window.levante.platform.getStatus()` | `{ isAuthenticated, user, allowedModels }` |
| `levante/platform/models` | `window.levante.platform.getModels()` | Fetch models with metadata from `/api/v1/models` |

## Authentication Flow

### Login (Onboarding)

```
ModeSelectionStep → platformStore.login()
  → IPC levante/platform/login
    → PlatformService.login()
      → OAuthService.authorize({
          serverId: 'levante-platform',
          mcpServerUrl: defaultUrl,
          scopes: ['openid', 'email']
        })
      → Browser opens → user authenticates → callback with code
      → Token exchange → access_token (JWT) + refresh_token stored
      → jwtDecode(accessToken) → { sub, email, allowed_models, org_id }
      → userProfileService.updateProfile({ appMode: 'platform', platformUser })
  ← { isAuthenticated: true, user, allowedModels }
```

### Login (From Models Page)

```
ModelPage platform card → platformStore.login()
  → Same OAuth flow as above
  → On success: appMode transitions to 'platform' in Zustand
  → App.tsx detects appMode change (useEffect + useRef for prev value)
  → Shows welcome dialog ("Welcome to Levante Platform!")
  → User clicks "Go to Account" → navigates to AccountPage
```

### Logout

```
AccountPage → confirmation dialog ("You will switch to standalone mode...")
  → platformStore.logout()
    → IPC levante/platform/logout
      → PlatformService.logout()
        → oauthService.disconnect() (tokens revoked)
        → userProfileService.updateProfile({ appMode: 'standalone' })
    → Zustand: set appMode='standalone', clear user/models
  → App.tsx detects appMode change:
    → If on account page → navigates to model page
  → MainLayout reactively switches sidebar: Account → Models
```

**Important**: `platformService.logout()` explicitly sets `appMode: 'standalone'` (not `undefined`). This ensures the profile on disk is updated correctly, since `userProfileService.updateProfile()` skips `undefined` values.

### Token Usage

- **Chat completions**: `providerResolver.getModelProvider()` detects `appMode === 'platform'` → calls `platformService.getAccessToken()` → uses `ensureValidToken()` (auto-refresh) → passes token as `apiKey` to `createOpenAICompatible()` → `POST /api/v1/chat/completions`
- **Model listing**: `platformService.fetchModelsWithMetadata()` → `getAuthHeaders()` (auto-refresh) → `GET /api/v1/models` with `Authorization: Bearer <accessToken>`. Handles 401 with retry after token refresh.
- **JWT claims**: `allowed_models: string[]` determines which models the user can access. If empty, the API is trusted to filter by plan.

### Boot Sequence

```
App.tsx → usePlatformStore.initialize()
  → Read appMode from user-profile.json (no encryption, no keychain)
  → If appMode === 'platform':
      → IPC getStatus() → check token validity
      → If valid: set authenticated, load user + allowedModels
      → fetchModels() in background
  → If appMode === 'standalone':
      → Set standalone, no token access
  → If null:
      → First run, wizard will show ModeSelectionStep
```

## Reactive Mode Switching

`App.tsx` watches `usePlatformStore.appMode` via a `useEffect` + `useRef` for the previous value:

- **Logout** (`platform` → `standalone`): If on the account page, auto-navigates to the model page. MainLayout reactively hides Account and shows Models in the sidebar.
- **Login from ModelPage** (`standalone` → `platform`): Shows a welcome `AlertDialog`. On dismiss, navigates to the account page. MainLayout reactively hides Models and shows Account in the sidebar.

No `window.location.reload()` is needed — transitions are fully reactive via Zustand subscriptions.

## UI Differences by Mode

| Feature | Platform Mode | Standalone Mode |
|---|---|---|
| Sidebar nav | Account (no Models page) | Models page (with platform sign-in card) |
| Model selector | Flat list (no provider groups) | Grouped by provider |
| Settings | No Security section | Full settings |
| Account page | Visible (user info, models, logout with confirmation) | Hidden |
| Models page | Hidden (sidebar shows Account instead) | Visible (with platform sign-in card at top) |
| Onboarding | ModeSelectionStep → MCP → Directory → Completion | ModeSelectionStep → Provider → MCP → Directory → Completion |
| CompletionStep | "Connected to Levante Platform" | Provider name, tips about switching |

### Model Selector Behavior

In platform mode, `useModelSelection` loads models from `platformStore.models` instead of `modelService`. `groupedModelsByProvider` is set to `null`, which makes `ModelSearchableSelect` fall back to its flat list rendering (no collapsible provider groups, no provider labels).

### ModelPage Platform Sign-In Card

In standalone mode, the Models page shows a prominent card at the top with a "Sign in" button for Levante Platform. The card uses a gradient border (`border-primary/30`) and a Zap icon. Clicking the button triggers `platformStore.login()` directly (no URL input — uses the default platform URL). On success, `App.tsx` detects the mode change and shows the welcome dialog.

### AccountPage Logout Confirmation

The logout button opens an `AlertDialog` confirming the action. The dialog explains that the user will switch to standalone mode and need to configure API keys manually. It also mentions they can log back in from the Models page.

## Internationalization (i18n)

All platform-related UI strings are translated (English + Spanish):

| Namespace | Keys | Used by |
|---|---|---|
| `account` | `title`, `description`, `manage_plan`, `log_out`, `models_title`, `models_description`, `no_models`, `logout_confirm_title`, `logout_confirm_description`, `org_label` | `AccountPage.tsx` |
| `models.platform` | `title`, `sign_in`, `signing_in`, `sign_in_description`, `welcome_title`, `welcome_description`, `welcome_go_to_account` | `ModelPage.tsx`, `App.tsx` (welcome dialog) |
| `wizard.modeSelection` | `title`, `subtitle`, `recommended`, `platformDescription`, `connected`, `continue`, `connecting`, `signIn`, `standalone`, `standaloneDescription`, `configureKeys` | `ModeSelectionStep.tsx` |
| `wizard.completion` | `platform_connected`, `manage_account_title`, `manage_account_description`, `steps.start_chatting_platform` | `CompletionStep.tsx` |
| `common.navigation` | `account` | `MainLayout.tsx` |

Translation files:
- `src/renderer/locales/en/account.json` / `src/renderer/locales/es/account.json`
- Platform keys added to existing `models.json`, `wizard.json`, `common.json`
- Registered in `src/renderer/i18n/config.ts`

## JWT Payload

The access token is a JWT with these claims:

```typescript
interface JWTPayload {
  sub?: string;           // User ID
  email?: string;         // User email
  allowed_models?: string[]; // Model IDs the user can access
  org_id?: string;        // Organization ID
  team_id?: string;       // Team ID
  exp?: number;           // Expiration (unix seconds)
  iat?: number;           // Issued at
}
```

The JWT is decoded client-side with `jwt-decode` (no verification — the backend validates on every API call).

## Storage

```
~/levante/
├── user-profile.json     → appMode, platformUser (NOT encrypted)
└── ui-preferences.json   → oauthTokens.levante-platform (encrypted via safeStorage)
```

- `appMode` and `platformUser` are stored in the unencrypted user profile so the boot sequence can check the mode without triggering keychain access.
- OAuth tokens (access + refresh) are stored encrypted in preferences, accessed only when `appMode === 'platform'`.
- On logout, `appMode` is explicitly set to `'standalone'` on disk (not cleared to `undefined`/`null`).

## Cleanup Notes

The following were removed when platform mode was refactored from "just another provider" to its own mode:

- `levante-platform` removed from `modelService` default providers and `getDefaultProviders()`
- `LevantePlatformConfig` component removed from `ProviderConfigs.tsx`
- `levante-platform` option removed from `ProviderStep.tsx` onboarding PROVIDERS array
- `useLevantePlatformOAuth` hook deleted (replaced by `usePlatformStore`)
- `src/renderer/services/model/providers/levanteProvider.ts` deleted (dead code)

The `'levante-platform'` value remains in the `ProviderType` union (`src/types/models.ts`) because `providerResolver` still uses it internally for the `createOpenAICompatible` provider name and the model `provider` field.

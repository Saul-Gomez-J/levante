# Analytics Metrics Documentation

## Overview

This document provides a comprehensive overview of all analytics metrics collected by Levante, including data types, purposes, and privacy considerations.

## Privacy-First Principles

Levante's analytics system is designed with privacy as a core principle:

- **Opt-in by default**: Users must explicitly consent to analytics tracking
- **Anonymous user IDs**: No personally identifiable information (PII) is collected
- **User control**: Users can enable/disable analytics at any time
- **Transparency**: All metrics are documented in this file
- **No tracking without consent**: All tracking methods check consent before sending data

## Consent Management

### How Consent Works

- Users are prompted during initial setup (wizard) to opt-in to analytics
- Consent status is stored locally in `user-profile.json` under `analytics.hasConsented`
- An anonymous user ID (`analytics.anonymousUserId`) is generated as a UUID v4
- Every tracking method calls `canTrack()` to verify consent before sending data
- Users can toggle analytics on/off in Settings at any time

### Consent Actions

**Enable Analytics:**
- Updates local profile: `hasConsented = true`
- Updates remote database: `sharing_data = true`

**Disable Analytics:**
- Updates local profile: `hasConsented = false`
- Updates remote database: `sharing_data = false`
- No further data is sent until re-enabled

## Data Storage

**Backend:** Supabase PostgreSQL database
**Schema:** `app_metrics`
**Connection:** HTTPS with authentication via anonymous key (read/write permissions controlled by RLS)

### Security Measures

- All data transmission over HTTPS
- Row Level Security (RLS) policies on database tables
- Anonymous authentication (no user accounts required)
- No session persistence
- No auto-refresh tokens

## Metrics Collected

### 1. User Registration (`trackUser()`)

**Purpose:** Track unique users and their consent status

**Table:** `users`

**Data Sent:**
```typescript
{
  user_id: string,           // Anonymous UUID v4
  first_seen_at: timestamp,  // When user first registered
  last_seen_at: timestamp,   // When user last seen
  sharing_data: boolean,     // Current consent status (true or false)
  updated_at: timestamp      // Last update time
}
```

**Trigger:** When user completes wizard (regardless of consent choice)

**Notes:**
- Uses `upsert` with `onConflict: 'user_id'` to prevent duplicates
- **ALL users are tracked**, with `sharing_data` set to their consent choice
- Users who decline analytics: `sharing_data: false`
- Users who accept analytics: `sharing_data: true`
- This allows measuring total user base and opt-in rates

---

### 2. App Opens (`trackAppOpen()`)

**Purpose:** Track application usage patterns, version distribution, and platform demographics

**Table:** `app_opens`

**Data Sent:**
```typescript
{
  user_id: string,        // Anonymous UUID v4
  app_version: string,    // e.g., "1.2.3"
  platform: string,       // "macOS" | "Windows" | "Linux"
  opened_at: timestamp    // When app was launched
}
```

**Trigger:**
- **First time (onboarding)**: Tracked for ALL users (regardless of consent)
- **App start without UUID**: If user somehow has no UUID, one is created with `sharing_data: false` and first open is tracked
- **Subsequent app starts**: Only tracked if user has consented (`sharing_data: true`)

**Platform Detection:**
- `darwin` → `"macOS"`
- `win32` → `"Windows"`
- `linux` → `"Linux"`

**Use Cases:**
- Understand version adoption rates
- Identify platform-specific issues
- Track active user engagement

**Notes:**
- The initial app open during onboarding is always tracked to measure total installs
- Users without UUID (edge case) are automatically assigned one with `sharing_data: false`
- After onboarding, only users who consented will have subsequent app opens tracked

---

### 3. Conversations (`trackConversation()`)

**Purpose:** Track chat activity to understand feature usage

**Table:** `conversations`

**Data Sent:**
```typescript
{
  user_id: string,       // Anonymous UUID v4
  created_at: timestamp  // When conversation started
}
```

**Trigger:** When a new conversation is created

**Notes:**
- Only tracks that a conversation occurred
- Does NOT track message content, model used, or conversation length
- Privacy-preserving metric for engagement analytics

---

### 4. MCP Usage (`trackMCPUsage()`)

**Purpose:** Track Model Context Protocol (MCP) server usage and adoption

**Table:** `mcp_usage`

**Data Sent:**
```typescript
{
  user_id: string,           // Anonymous UUID v4
  mcp_name: string,          // Name of MCP server (e.g., "filesystem", "git")
  status: 'active' | 'removed',  // Server status
  event_at: timestamp        // When event occurred
}
```

**Trigger:**
- When a user adds an MCP server (`status: 'active'`)
- When a user removes an MCP server (`status: 'removed'`)

**Use Cases:**
- Understand which MCP servers are most popular
- Track MCP ecosystem adoption
- Identify servers that may need better documentation/support

---

### 5. Provider Statistics (`trackProviderStats()`)

**Purpose:** Track AI provider usage and model selection patterns

**Table:** `provider_stats` (via RPC function `log_provider_stats`)

**Data Sent:**
```typescript
{
  user_id: string,              // Anonymous UUID v4
  provider_name: string,        // e.g., "OpenRouter", "OpenAI", "Anthropic"
  active_models_count: number   // Number of models user has selected
}
```

**Trigger:** When user updates their selected models for a provider

**Use Cases:**
- Understand provider popularity
- Track multi-provider adoption
- Identify model selection patterns

**Notes:**
- Uses RPC function for aggregation/deduplication logic on server
- Does NOT track which specific models are selected, only the count

---

### 6. Runtime Usage (`trackRuntimeUsage()`)

**Purpose:** Track Python/Node.js runtime usage for MCP servers

**Table:** `runtime_usage`

**Data Sent:**
```typescript
{
  user_id: string,                    // Anonymous UUID v4
  runtime_type: 'node' | 'python',    // Runtime type
  runtime_version: string,            // e.g., "3.11.5", "20.10.0"
  runtime_source: 'system' | 'shared', // Where runtime came from
  action: 'installed' | 'used',       // Event type
  mcp_server_id?: string,             // Optional: which MCP server used it
  event_at: timestamp                 // When event occurred
}
```

**Trigger:**
- When user installs a shared runtime (`action: 'installed'`)
- When a runtime is used to run an MCP server (`action: 'used'`)

**Runtime Sources:**
- `system`: User's system-installed Python/Node.js
- `shared`: Levante-managed shared runtime

**Use Cases:**
- Understand runtime distribution across users
- Track shared runtime adoption
- Debug runtime-related issues
- Improve runtime compatibility

---

## Data NOT Collected

To maintain user privacy, Levante explicitly **does NOT collect**:

- Message content or conversation history
- API keys or credentials
- User identity (name, email, etc.)
- File paths or local file names
- IP addresses (beyond basic request metadata)
- Specific model names selected by users
- MCP tool execution results
- Code or commands executed
- Personal data of any kind

## Implementation Details

### Service Architecture

```
AnalyticsService
  ├── canTrack() - Checks user consent
  ├── getUserId() - Retrieves anonymous ID
  └── SupabaseClient
        └── Supabase Database (app_metrics schema)
```

### Key Files

- `src/main/services/analytics/analyticsService.ts` - Main service with consent checks
- `src/main/services/analytics/supabaseClient.ts` - Database client
- `src/types/analytics.ts` - TypeScript type definitions

### Error Handling

- All tracking methods are **non-blocking**
- Errors are logged but do NOT prevent app functionality
- Failed tracking attempts are logged to `analytics` category
- No user-facing errors for tracking failures

### Logging

Analytics operations are logged under the `analytics` category:

```typescript
logger.analytics.info('User tracked successfully', { userId });
logger.analytics.error('Error tracking app open', { error });
```

Enable analytics logging in `.env.local`:
```bash
DEBUG_ANALYTICS=true
```

## Database Schema

**Supabase Project:** `fgwotpadzuuvnaritbcx`
**Schema:** `app_metrics`

### Tables

1. **users** - User registration and consent
2. **app_opens** - Application launch events
3. **conversations** - Chat activity
4. **mcp_usage** - MCP server adoption
5. **provider_stats** - AI provider usage (via RPC)
6. **runtime_usage** - Python/Node.js runtime tracking

### Row Level Security (RLS)

All tables have RLS policies to ensure:
- Users can only insert their own data
- No user can read other users' data
- Server-side aggregation through RPC functions

## User Control

### Settings UI

Users can control analytics through **Settings > Privacy > Analytics**:

- Toggle analytics on/off
- View what data is collected (link to this document)
- Understand consent implications

### Data Deletion

Users who wish to delete their analytics data should contact support. The anonymous nature of the data means we can delete records by `user_id` without requiring additional verification.

## Compliance

### GDPR Considerations

- **Lawful basis:** Consent (Article 6(1)(a))
- **Data minimization:** Only essential metrics collected
- **Transparency:** Full documentation provided
- **User rights:** Users can withdraw consent anytime
- **Anonymization:** No PII collected

### Data Retention

- Analytics data is retained indefinitely for product improvement
- Users can request deletion by contacting support with their anonymous user ID

## Future Considerations

Potential future metrics (not yet implemented):

- Feature usage analytics (e.g., which UI components are used)
- Performance metrics (e.g., response times, error rates)
- Plugin/extension usage

All future metrics will follow the same privacy-first principles and require user consent.

## Questions or Concerns

For questions about analytics, data privacy, or to request data deletion:
- Open an issue on GitHub: https://github.com/anthropics/levante/issues
- Contact: [Add support email when available]

---

**Last Updated:** 2025-12-05
**Document Version:** 1.0.0

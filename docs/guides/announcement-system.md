# Announcement System

The announcement system provides a way to display important notifications, updates, and privacy notices to users through a modal interface. Announcements are fetched from `services.levanteapp.com` and displayed based on category priority and user preferences.

## Overview

The system automatically checks for new announcements at app startup (after wizard completion) and periodically every hour. It supports multiple announcement categories with priority-based display, HTML rendering for rich content, and interactive elements like buttons and deep links.

### Key Features

- **Per-category tracking**: Separate tracking for `announcement`, `app`, and `privacy` categories
- **Priority-based display**: Shows one announcement per execution in order of priority
- **HTML rendering**: Rich content with inline styles, images, and interactive buttons
- **Localization**: Language parameter based on user preferences
- **Privacy integration**: Special handling for analytics consent via privacy announcements
- **Automatic migration**: Seamless upgrade from legacy announcement tracking format

## Architecture

### Core Components

```
Main Process
├── announcementService.ts      → Core logic, API fetching, periodic checks
├── announcementHandlers.ts     → IPC handlers (check/markSeen/enablePrivacy)
└── userProfileService.ts       → Storage of last seen announcements

Preload
├── api/announcements.ts        → Preload API bridge
└── types/index.ts              → Type exports

Renderer
├── AnnouncementModal.tsx       → Modal component with HTML rendering
└── App.tsx                     → Startup check integration
```

### Data Flow

```
Startup/Periodic Check → announcementService.checkForAnnouncements()
                      → Fetch from API with language + categories
                      → Filter unseen announcements
                      → Select by priority (announcement > app > privacy)
                      → Return to renderer
                      → Display in AnnouncementModal
                      → User closes → markSeen() → Update user-profile.json
```

## API Integration

### Endpoint

```
GET https://services.levanteapp.com/api/announcements
  ?category=announcement,app[,privacy]
  &language=en|es

Headers:
  Accept: application/json
  Cache-Control: no-cache
  Pragma: no-cache
```

### Category Logic

| Category | When Sent | Description |
|----------|-----------|-------------|
| `announcement` | Always | General product announcements |
| `app` | Always | App-specific updates |
| `privacy` | Conditional | Privacy notices (only when `analytics.hasConsented === false`) |

### Response Formats

The API returns different formats depending on the number of categories:

**Single Category Response:**
```json
{
  "announcement": {
    "id": "uuid",
    "title": "New Feature Released",
    "full_text": "<p>HTML content...</p>",
    "category": "announcement",
    "created_at": "2025-12-28T09:32:20+00:00"
  }
}
```

**Multiple Categories Response:**
```json
{
  "announcements": [
    {
      "id": "uuid",
      "title": "New Feature Released",
      "full_text": "<p>HTML content...</p>",
      "category": "announcement",
      "created_at": "2025-12-28T09:32:20+00:00"
    }
  ],
  "total": 1
}
```

The service automatically normalizes both formats to an array for consistent processing.

## Storage

Announcement tracking is stored in the user profile at `~/levante/user-profile.json`:

```json
{
  "analytics": {
    "hasConsented": false,
    "lastSeenAnnouncements": {
      "announcement": "uuid-1",
      "app": "uuid-2",
      "privacy": "uuid-3"
    }
  }
}
```

### Migration from Legacy Format

Users upgrading from the old single-ID format are automatically migrated:

**Before (v1.0):**
```json
{
  "analytics": {
    "lastSeenAnnouncementId": "single-uuid"
  }
}
```

**After (v1.1+):**
```json
{
  "analytics": {
    "lastSeenAnnouncements": {
      "announcement": "single-uuid"
    }
  }
}
```

Migration runs automatically in `userProfileService.initialize()`.

## IPC Communication

### Available Channels

All IPC channels use the `levante/announcements/*` namespace:

| Channel | Parameters | Returns | Description |
|---------|------------|---------|-------------|
| `levante/announcements/check` | None | `LevanteApiResponse<Announcement>` | Check for new announcements |
| `levante/announcements/mark-seen` | `id: string, category: AnnouncementCategory` | `LevanteApiResponse<void>` | Mark announcement as seen |
| `levante/announcements/enable-privacy` | `id: string` | `LevanteApiResponse<void>` | Enable analytics and mark as seen |

### Usage in Renderer

```typescript
// Check for announcements
const result = await window.levante.announcements.check();
if (result.success && result.data) {
  // Display announcement modal
  setAnnouncement(result.data);
}

// Mark as seen when user closes modal
await window.levante.announcements.markSeen(
  announcement.id,
  announcement.category
);

// Enable privacy consent (privacy announcements only)
await window.levante.announcements.enablePrivacy(announcement.id);
```

## Priority System

When multiple categories have new announcements, they are displayed one at a time in priority order:

1. **announcement** - Highest priority, general product announcements
2. **app** - Medium priority, app-specific updates
3. **privacy** - Lowest priority, privacy notices

Example: If all three categories have new announcements, the user will see the `announcement` first. After closing it, on the next check (hourly or next startup), they'll see the `app` announcement, and so on.

## HTML Content & Rendering

### Supported Features

The `full_text` field contains HTML that is rendered with `dangerouslySetInnerHTML`, enabling:

- **Rich formatting**: Headers, paragraphs, lists, inline styles
- **Images**: With custom styling (borders, sizing, centering)
- **Interactive buttons**: Navigation and deep link actions
- **Custom layouts**: Flexbox, grid, centering, etc.

### Button Actions

Buttons can have `data-action` and `data-href` attributes for interactivity:

| Action | Description | Example |
|--------|-------------|---------|
| `navigate` | Navigate to internal page | `data-action="navigate" data-href="settings"` |
| `deeplink` | Open levante:// deep link | `data-action="deeplink" data-href="levante://mcp/add?..."` |

**Available pages for navigation:** `chat`, `settings`, `models`, `store`

### CSS Classes

Three button classes are available in `globals.css`:

```css
.announcement-content .btn-primary    /* Primary action button */
.announcement-content .btn-secondary  /* Secondary/outline button */
.announcement-content .btn-link       /* Link-style button */
```

### HTML Examples

**Basic Announcement:**

```html
<div style="text-align: center;">
  <h2>New Feature</h2>
  <p>We've added a new feature to the app!</p>
  <button data-action="navigate" data-href="settings" class="btn-primary">
    Go to Settings
  </button>
</div>
```

**MCP Server Installation:**

```html
<div style="text-align: center;">
  <h2>New MCP Server Available</h2>

  <img src="https://example.com/server-icon.jpg"
       alt="Server preview"
       style="display: block; margin: 0 auto 20px auto; max-width: 120px; border-radius: 8px;" />

  <p>Install our new MCP server for enhanced functionality.</p>

  <ul style="text-align: left; display: inline-block;">
    <li>Feature 1: Enhanced code analysis</li>
    <li>Feature 2: Real-time collaboration</li>
    <li>Feature 3: Automated workflows</li>
  </ul>

  <button
    data-action="deeplink"
    data-href="levante://mcp/add?name=Server%20Name&transport=streamable-http&url=https://server.example.com/"
    class="btn-primary">
    Install Server
  </button>
</div>
```

### Styling Notes

- The modal applies Tailwind's `prose` classes for automatic styling of standard HTML elements
- Dark mode is handled automatically via `dark:prose-invert`
- Inline styles are supported for custom layouts and positioning
- The modal already includes a "Close" button, so no dismiss actions are needed in HTML content

## Modal Display

The `AnnouncementModal` component provides:

- **Title display**: `announcement.title` shown as heading
- **HTML content**: Rendered safely in a scrollable area
- **Action buttons**: Interactive elements from HTML content
- **Close button**: Always available (marks announcement as seen)
- **Privacy button**: "Enable Analytics" appears only when `category === 'privacy'`

### Modal Layout

```
┌────────────────────────────────────────┐
│ # {title}                              │
│ ────────────────────────────────────   │
│                                        │
│ {HTML content rendered}                │
│ - Images, paragraphs, lists            │
│ - Interactive buttons                  │
│                                        │
│ ┌─────────────────┐  ┌──────────────┐ │
│ │ Enable Analytics│  │    Close     │ │
│ └─────────────────┘  └──────────────┘ │
│  (only for privacy category)          │
└────────────────────────────────────────┘
```

## Service Usage

### Main Process

```typescript
import { announcementService } from './services/announcementService';

// Initialize (called automatically in main.ts)
announcementService.initialize();

// Manual check for announcements
const announcement = await announcementService.checkForAnnouncements();
if (announcement) {
  // Announcement available
}

// Mark announcement as seen
await announcementService.markAsSeen(
  announcementId,
  'announcement' // category
);

// Enable privacy consent (clears privacy tracking)
await announcementService.enablePrivacyConsent(announcementId);
```

### Behavior Details

1. **Initialization**: Sets up periodic checks (every hour) in main.ts
2. **Startup Check**: Triggered after wizard completion in App.tsx
3. **Deduplication**: Compares announcement ID with category-specific last seen ID
4. **Single Display**: Only one announcement shown per check, even if multiple are available
5. **Privacy Handling**: When user enables analytics, privacy tracking is cleared to allow future privacy announcements if they disable consent again

## Privacy Consent Behavior

Special handling for privacy announcements and analytics consent:

### When User Enables Analytics

```typescript
// Via announcement modal "Enable Analytics" button
await window.levante.announcements.enablePrivacy(announcementId);
```

**Actions performed:**
1. Set `analytics.hasConsented = true`
2. Set `analytics.consentedAt = currentTimestamp`
3. **Clear** `analytics.lastSeenAnnouncements.privacy`
4. Keep `announcement` and `app` tracking unchanged

**Rationale:** If a user later disables analytics consent, they should see new privacy announcements explaining the change.

### Category Filtering

Privacy announcements are only requested when:
```typescript
if (analytics.hasConsented === false) {
  categories.push('privacy');
}
```

This prevents unnecessary API requests for users who have already consented.

## Files Reference

### Type Definitions

| File | Exports |
|------|---------|
| `src/types/announcement.ts` | `Announcement`, `AnnouncementCategory`, `LastSeenAnnouncements`, `AnnouncementApiResponse` |
| `src/types/userProfile.ts` | Updated `AnalyticsConsent` with `lastSeenAnnouncements` |

### Main Process Services

| File | Purpose |
|------|---------|
| `src/main/services/announcementService.ts` | Core announcement logic: fetching, filtering, priority selection, periodic checks |
| `src/main/services/userProfileService.ts` | Storage and migration of announcement tracking |
| `src/main/ipc/announcementHandlers.ts` | IPC handlers for renderer communication |
| `src/main/lifecycle/initialization.ts` | Registration of announcement handlers |
| `src/main/main.ts` | Service initialization at app startup |

### Preload Bridge

| File | Purpose |
|------|---------|
| `src/preload/api/announcements.ts` | Preload API implementation |
| `src/preload/preload.ts` | LevanteAPI type definitions |
| `src/preload/types/index.ts` | Type exports for renderer |

### Renderer Components

| File | Purpose |
|------|---------|
| `src/renderer/components/announcements/AnnouncementModal.tsx` | Modal component with HTML rendering and actions |
| `src/renderer/App.tsx` | Startup announcement check integration |
| `src/renderer/globals.css` | Button styling classes |

### Security

| File | Purpose |
|------|---------|
| `src/main/utils/urlSecurity.ts` | URL protocol validation (includes `levante:` for deep links) |

## Testing Checklist

When testing the announcement system, verify:

- [ ] Fresh user sees announcement modal on first launch (after wizard)
- [ ] After closing, same announcement doesn't show again
- [ ] Multiple new announcements show one per execution (priority order)
- [ ] Toggling privacy settings preserves announcement tracking
- [ ] Enabling analytics via modal clears privacy tracking
- [ ] Language parameter matches user preference (en/es)
- [ ] Migration from old `lastSeenAnnouncementId` format works correctly
- [ ] HTML content renders correctly with styles and images
- [ ] Navigate buttons work (change pages without closing modal first)
- [ ] Deep link buttons work (open levante:// URLs)
- [ ] Privacy modal shows "Enable Analytics" button only for privacy category
- [ ] Hourly periodic checks work as expected
- [ ] API handles both singular and array response formats

## Future Enhancements

Potential improvements for consideration:

- Action tracking/analytics for button clicks in announcements
- Scheduled announcements (show at specific times)
- User-dismissible announcements (without marking as seen)
- Announcement history viewer
- Rich notification badges on specific UI elements

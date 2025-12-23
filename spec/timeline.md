# Timeline Specifications

## Current Implementation

### Timeline Display
- Timeline pane on the left side of the screen
- Multiple timelines supported (one per Timeline node)
- Each timeline has:
  - Header with timeline name
  - Scrollable event list
  - 35 character width per column

### Event Item Display
Each event displays:
- **Icon**: Profile picture from kind:0 event (default avatar if unavailable)
- **Display Name**: `kind0.content.display_name` (fallback to name, then npub)
- **Username**: `@kind0.content.name` (fallback to npub)
- **Content**: Event text content
- **Timestamp**: Formatted date/time of `event.created_at`

### Supported Event Kinds
| Kind | Type | Display |
|------|------|---------|
| 0 | Profile | icon, name, display name |
| 1 | Text Note | Full content display |
| 7 | Reaction | Reaction emoji/text |

### Profile Cache
- Profiles (kind:0) are cached in localStorage
- Cache key: `mojimoji-profile-cache`
- Profiles fetched automatically for event authors

---

## Planned Features

### NIP-36: Content Warning Support

**Reference**: [NIP-36](https://github.com/nostr-protocol/nips/blob/master/36.md)

#### Overview
NIP-36 defines content warning tags for marking sensitive content that requires user approval before display.

#### Tag Format
```json
["content-warning", "<reason>"]
```
- `content-warning`: Tag name
- `<reason>`: Optional explanation for the warning (e.g., "nudity", "spoiler", "violence")

#### Implementation Plan

1. **Detection**
   - Check event tags for `content-warning` tag
   - Extract reason if provided

2. **UI Display**
   - Hide event content by default when content-warning tag is present
   - Show warning overlay with:
     - Warning icon
     - Reason text (if provided) or generic "Content Warning" message
     - "Show Content" button
   - On button click: reveal the actual content

3. **User Preferences** (future)
   - Option to always show content warnings
   - Option to auto-hide specific warning types
   - Per-author content warning settings

#### Example Display
```
┌─────────────────────────────────┐
│ [icon] Display Name             │
│ @username                       │
│ ─────────────────────────────── │
│ ⚠️ Content Warning: spoiler     │
│        [Show Content]           │
│ ─────────────────────────────── │
│ 2025-01-01 12:00:00            │
└─────────────────────────────────┘
```

---

### Image Display in Timeline

#### Overview
Display images (jpg, jpeg, gif, png) embedded in event content.

#### Supported Formats
| Extension | MIME Type |
|-----------|-----------|
| .jpg, .jpeg | image/jpeg |
| .gif | image/gif |
| .png | image/png |

#### Implementation Plan

1. **URL Detection**
   - Parse event content for image URLs
   - Regex pattern: `https?://[^\s]+\.(jpg|jpeg|gif|png)(\?[^\s]*)?`
   - Support common image hosting services

2. **UI Display**
   - Render detected image URLs as `<img>` elements
   - Limit image display size (max-width: 100%, max-height: 300px)
   - Lazy loading for performance
   - Click to open full-size image in new tab

3. **Security Considerations**
   - Only load images from HTTPS URLs
   - Consider CSP (Content Security Policy) headers
   - Add loading/error states for images
   - Respect user preference to disable image loading

4. **Content Warning Integration**
   - If event has `content-warning` tag, hide images until revealed
   - Consider separate option for "sensitive media" warnings

#### Example Display
```
┌─────────────────────────────────┐
│ [icon] Display Name             │
│ @username                       │
│ ─────────────────────────────── │
│ Check out this photo!           │
│ ┌─────────────────────────────┐ │
│ │                             │ │
│ │      [image preview]        │ │
│ │                             │ │
│ └─────────────────────────────┘ │
│ ─────────────────────────────── │
│ 2025-01-01 12:00:00            │
└─────────────────────────────────┘
```

---

## NIP References

- [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md): Basic protocol (event structure)
- [NIP-36](https://github.com/nostr-protocol/nips/blob/master/36.md): Sensitive Content / Content Warning

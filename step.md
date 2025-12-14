# Implementation Checklist

## NIP-36: Content Warning Support

### 1. Update specifications
- [x] Add NIP-36 plan to spec/timeline.md

### 2. Implementation

#### 2.1 Types
- [x] Add `contentWarning` field to `TimelineEvent` type in `src/nostr/types.ts`
- [x] Add content warning extraction function

#### 2.2 Event Processing
- [x] Extract `content-warning` tag when processing events in GraphEditor
- [x] Pass content warning info to TimelineItem

#### 2.3 UI Components
- [x] Create ContentWarning overlay in TimelineItem
- [x] Add warning overlay with reason text
- [x] Add "Show Content" button
- [x] Add state to track revealed/hidden status

#### 2.4 Styling
- [x] Add CSS for content warning overlay
- [x] Add warning icon styling
- [x] Add button styling

#### 2.5 i18n
- [x] Add English translations for content warning UI
- [x] Add Japanese translations for content warning UI

---

## Image Display in Timeline

### 1. Update specifications
- [x] Add image display plan to spec/timeline.md

### 2. Implementation

#### 2.1 URL Detection
- [x] Create image URL extraction utility function
- [x] Support jpg, jpeg, gif, png extensions
- [x] Handle query strings in URLs

#### 2.2 UI Components
- [x] Create ImagePreview component in `src/components/Timeline/`
- [x] Add lazy loading for images
- [x] Add loading state indicator (shimmer animation)
- [x] Add error handling with fallback (hide broken images)
- [x] Add click to open full-size in new tab

#### 2.3 Content Rendering
- [x] Update TimelineItem to detect and render images
- [x] Split content into text and image parts
- [x] Render images below text

#### 2.4 Styling
- [x] Add CSS for image preview (max-width, max-height)
- [x] Add loading state styling (shimmer animation)
- [x] Add hover effects

#### 2.5 Security
- [x] Validate URLs (https:// only via regex)
- [ ] Consider CSP headers (future)

#### 2.6 Content Warning Integration
- [x] Hide images when event has content-warning tag
- [x] Show images only after user reveals content

---

## Testing
- [ ] Test content warning display with real Nostr events
- [ ] Test image display with various image URLs
- [ ] Test content warning + image combination
- [ ] Test error handling for broken image URLs

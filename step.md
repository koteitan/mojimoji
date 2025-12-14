# Implementation Checklist

## NIP-36: Content Warning Support

### 1. Update specifications
- [x] Add NIP-36 plan to spec/timeline.md

### 2. Implementation

#### 2.1 Types
- [ ] Add `contentWarning` field to `TimelineEvent` type in `src/nostr/types.ts`
- [ ] Add content warning extraction function

#### 2.2 Event Processing
- [ ] Extract `content-warning` tag when processing events in RelayNode
- [ ] Pass content warning info to TimelineItem

#### 2.3 UI Components
- [ ] Create ContentWarning component in `src/components/Timeline/`
- [ ] Add warning overlay with reason text
- [ ] Add "Show Content" button
- [ ] Add state to track revealed/hidden status

#### 2.4 Styling
- [ ] Add CSS for content warning overlay
- [ ] Add warning icon styling
- [ ] Add button styling

#### 2.5 i18n
- [ ] Add English translations for content warning UI
- [ ] Add Japanese translations for content warning UI

---

## Image Display in Timeline

### 1. Update specifications
- [x] Add image display plan to spec/timeline.md

### 2. Implementation

#### 2.1 URL Detection
- [ ] Create image URL extraction utility function
- [ ] Support jpg, jpeg, gif, png extensions
- [ ] Handle query strings in URLs

#### 2.2 UI Components
- [ ] Create ImagePreview component in `src/components/Timeline/`
- [ ] Add lazy loading for images
- [ ] Add loading state indicator
- [ ] Add error handling with fallback
- [ ] Add click to open full-size in new tab

#### 2.3 Content Rendering
- [ ] Update TimelineItem to detect and render images
- [ ] Split content into text and image parts
- [ ] Render images inline with text

#### 2.4 Styling
- [ ] Add CSS for image preview (max-width, max-height)
- [ ] Add loading/error state styling
- [ ] Add hover effects

#### 2.5 Security
- [ ] Validate URLs start with https://
- [ ] Consider CSP headers

#### 2.6 Content Warning Integration
- [ ] Hide images when event has content-warning tag
- [ ] Show images only after user reveals content

---

## Testing
- [ ] Test content warning display with real Nostr events
- [ ] Test image display with various image URLs
- [ ] Test content warning + image combination
- [ ] Test error handling for broken image URLs

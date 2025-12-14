# Mobile Layout Specification

## Overview
On mobile devices (screen width ≤ 768px), the layout changes from vertical split (timeline on bottom, graph on top) to horizontal scroll layout inspired by [rabbit](https://github.com/syusui-s/rabbit).

## Layout Structure

### Desktop (> 768px)
- Left pane: Timeline columns (horizontal scroll within pane)
- Right pane: Graph editor
- Title bar at top of timeline pane

### Mobile (≤ 768px)
- Full screen horizontal scroll container
- Title bar fixed at top
- Content area below title bar:
  - Timeline columns (each ~85vw width)
  - Graph view as the last "column" (100vw width)
- CSS scroll-snap for smooth column switching
- User can swipe left/right to switch between timelines and graph

## CSS Implementation

### Container (.app on mobile)
```css
@media (max-width: 768px) {
  .app {
    flex-direction: column;  /* title bar on top, content below */
  }
}
```

### Title Bar (mobile)
- Fixed at top
- Full width
- Same styling as desktop

### Content Container (new .main-content on mobile)
```css
@media (max-width: 768px) {
  .main-content {
    display: flex;
    flex-direction: row;
    overflow-x: scroll;
    scroll-snap-type: x mandatory;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
  }
}
```

### Timeline Column (mobile)
```css
@media (max-width: 768px) {
  .timeline-column {
    width: 85vw;           /* Slightly less than full width to hint next column */
    flex-shrink: 0;
    scroll-snap-align: center;
    scroll-snap-stop: always;
  }
}
```

### Graph Pane (mobile)
```css
@media (max-width: 768px) {
  .graph-pane {
    width: 85vw;           /* Same as timeline to show hint of adjacent column */
    flex-shrink: 0;
    scroll-snap-align: center;
    scroll-snap-stop: always;
  }
}
```

## Behavior

### Scroll Snapping
- Each timeline column snaps to center
- Graph view snaps to center
- Smooth scrolling between columns
- Mandatory snapping (always snaps to nearest column)

### Empty State
- When no timelines exist, show empty state message
- Graph view is still accessible by scrolling right

### Touch Interaction
- 1-finger swipe left/right to switch columns (scroll between timelines and graph)
- 1-finger swipe up/down for vertical scroll within each timeline column
- 2-finger gesture in graph view:
  - 2-finger drag to pan the graph
  - Pinch to zoom the graph

## Visual Indicators
- Partial visibility of adjacent columns hints that more content exists
- Current column is centered in viewport

## Accessibility
- Keyboard navigation: Tab to move between columns
- Screen reader: ARIA labels for each column

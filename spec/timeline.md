# Timeline Specifications
timeline shows all data not only Nostr events.

## Layout
### notes

- north:
  - left: icon (profile picture)
  - right:
    - north: display_name
    - south: @name
- middle: content
- south:
  - [date time] [reaction icon] [number of reactions] [repost icon] [number of reposts]
    - [date time] is aligned to the left
    - the others are aligned to the right

### reaction list dialog

Reaction list view is modal dialog in center of screen.
- [reaction list item]
- [reaction list item]
- ...
- [close button]

### reaction list item

- [icon] [simple profile] [reaction contents] [date time]

- simple profile:
  - north: display_name
  - south: @name
- reaction contents:
  - reaction
    - reaction content
  - repost
    - (none)

## design

- date time: YYYY/MM/DD hh:mm:ss
- reaction icon: heart mark
  - border color: #666
  - fill color:
    - if the app user gave a reaction: light pink
    - if not found the reaction the app user gave: transparent
- repost icon: cycle mark
  - border color: #666
  - fill color:
    - if the app user gave a repost: light pink
    - if not found the repost the app user gave: transparent

## behaviour
- on load:
  - boot background job of reaction fetcher for each relay like profile fetcher
- on receiving the new event by timeline:
  - add the reaction fetcher enqueue the event id for reaction queue
- on the next job of reaction fetcher:
  - pop event ids from reaction queue (batch in 1000ms or 50 items)
  - start a reaction subscription with filter of kinds:[6,7] and #e tag with the event ids using backward strategy
  - fetch from app user's relay list (kind:10002)
- on receive the reaction/repost by reaction subscription:
  - increment the number of reactions/reposts
  - cache the reaction/repost event with the note
- on the reaction subscription got EOSE:
  - close the reaction subscription (backward strategy auto-closes on EOSE)
  - wait for the next batch
- on click the reaction icon:
  - send a reaction "+" to the event (#e:event id, #p:event author) by app user's npub to app user's relays
- on click the repost icon:
  - send a repost of the event (#e:event id, #p:event author) by app user's npub to app user's relays
- on click the number of reactions/reposts:
  - show the reaction list dialog

## error handling
- same as ProfileFetcher
  - ignore parse errors
  - log subscription errors to console
  - continue processing on errors

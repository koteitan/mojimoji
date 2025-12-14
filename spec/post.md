# Post Feature Specification

## Overview
Add a Post button to the toolbar that allows users to create and publish kind:1 notes to Nostr relays.

## UI

### Post Dialog
- Modal dialog with dark theme (consistent with Save/Load dialogs)
- Title: "Post Note" / "ノートを投稿"

#### Dialog Contents
1. **Content Area**
   - Multiline textarea for note content
   - No placeholder
   - Character count display (optional, no hard limit)

2. **Your Pubkey Display**
   - Show npub format of user's pubkey (obtained from NIP-07)
   - Format: "Your pubkey: npub1..." / "あなたの公開鍵: npub1..."

3. **Action Buttons**
   - Relay button: open Relay dialog
   - Cancel button: close dialog without posting
   - Post button: publish the note
   - Post button shows "Posting..." / "投稿中..." while publishing

### Relay Dialog
- Modal dialog (opened from Post dialog)
- Title: "Relay Settings" / "リレー設定"

#### Dialog Contents
1. **Relay URLs**
   - Label: "Post to relays" / "投稿先リレー"
   - Multiline textarea for relay URLs (one per line)
   - Default value: relays from user's kind:10002 event (fetched on dialog open)

2. **Action Buttons**
   - kind:10002 button: reset relay list to kind:10002 relays
   - Cancel button: close dialog without saving changes
   - OK button: save relay list and close dialog

## Behavior

### Toolbar

#### On click Post button
1. Check for NIP-07 extension availability
2. If not available: show error "NIP-07 extension not available..."
3. Get user's pubkey from NIP-07
4. Fetch kind:10002 relays and store as relay list
5. Open Post dialog with npub displayed

### Post Dialog

#### On click Relay button
1. Open Relay dialog
2. Show current relay list in textarea

#### On click Cancel button
1. Close Post dialog without posting

#### On click Post button
1. Validate content is not empty
   - If empty: show error "Please enter content"
2. Validate relay list is not empty
   - If empty: show error "No relays available..."
3. Create unsigned kind:1 event:
   ```json
   {
     "kind": 1,
     "created_at": <current unix timestamp>,
     "tags": [],
     "content": "<user input>",
     "pubkey": "<from NIP-07>"
   }
   ```
4. Request NIP-07 extension to sign the event
   - If rejected: show error "Signing was rejected"
5. Publish signed event to all relays in relay list
6. Wait for at least one relay to accept (OK message)
   - If all fail: show error "Failed to publish note"
7. Show success message and close dialog

### Relay Dialog

#### On click kind:10002 button
1. Reset textarea to kind:10002 relays (fetched on Post dialog open)

#### On click Cancel button
1. Close Relay dialog without saving changes

#### On click OK button
1. Save relay list from textarea
2. Close Relay dialog

## Technical Implementation

### NIP-07 Integration
- Use `window.nostr.getPublicKey()` to get user's pubkey
- Use `window.nostr.signEvent(event)` to sign the event

### Relay Fetching (kind:10002)
- Reuse existing relay fetching logic from Save/Load dialogs
- Extract write relays (tags with "write" marker or no marker)

### Event Publishing
- Use rx-nostr to publish event to multiple relays
- Consider event published if at least one relay accepts

## i18n Keys
```json
{
  "toolbar": {
    "post": "Post"
  },
  "dialogs": {
    "post": {
      "title": "Post Note",
      "yourPubkey": "Your pubkey",
      "relay": "Relay",
      "post": "Post",
      "posting": "Posting...",
      "errorNoNip07": "NIP-07 extension not available. Please install a Nostr signer extension like nos2x or Alby.",
      "errorNoContent": "Please enter content",
      "errorNoRelays": "No relays available. Please configure relays.",
      "errorSigningRejected": "Signing was rejected",
      "errorUnknown": "Failed to publish note"
    },
    "relay": {
      "title": "Relay Settings",
      "relayUrlsLabel": "Post to relays",
      "kind10002": "kind:10002",
      "ok": "OK"
    }
  }
}
```

## Future Enhancements (out of scope)
- Content warning tag support
- Hashtag extraction (#tag → ["t", "tag"])
- Reply to event (["e", "<event-id>", "", "reply"])
- Quote repost
- Image upload
- Mention users (@npub → ["p", "<pubkey>"])

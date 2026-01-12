import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createRxNostr } from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import { isNip07Available, getPubkey, signEvent } from '../../nostr/nip07';
import type { UnsignedEvent } from '../../nostr/nip07';
import { fetchUserRelayList } from '../../nostr/graphStorage';
import { getCachedProfile } from '../../nostr/profileCache';
import { formatNpub, extractImageUrls, type NostrEvent, type Profile } from '../../nostr/types';
import { RelaySettingsDialog } from './RelaySettingsDialog';
import { Nip07ErrorMessage } from './Nip07ErrorMessage';
import './Dialog.css';

const DEFAULT_AVATAR = `${import.meta.env.BASE_URL}mojimoji-icon.png`;

// Reply target info
export interface ReplyTarget {
  event: NostrEvent;
  profile?: Profile;
}

interface PostDialogProps {
  isOpen: boolean;
  onClose: () => void;
  replyTo?: ReplyTarget;
}

export function PostDialog({ isOpen, onClose, replyTo }: PostDialogProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNip07Error, setIsNip07Error] = useState(false);
  const [userPubkey, setUserPubkey] = useState<string | null>(null);
  const [relayUrls, setRelayUrls] = useState<string[]>([]);
  const [kind10002Relays, setKind10002Relays] = useState<string[]>([]);
  const [relayDialogOpen, setRelayDialogOpen] = useState(false);
  const [mouseDownOnOverlay, setMouseDownOnOverlay] = useState(false);

  // Load user's pubkey and relay list when dialog opens
  useEffect(() => {
    if (isOpen) {
      const loadUserData = async () => {
        if (!isNip07Available()) {
          setIsNip07Error(true);
          return;
        }
        try {
          setError(null);
          const pubkey = await getPubkey();
          setUserPubkey(pubkey);
          // Fetch user's write relay list from kind:10002
          const relays = await fetchUserRelayList('write');
          setKind10002Relays(relays);
          setRelayUrls(relays);
        } catch (e) {
          setError(e instanceof Error ? e.message : t('dialogs.post.errorUnknown'));
        }
      };
      loadUserData();
    }
  }, [isOpen, t]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setContent('');
      setPosting(false);
      setError(null);
      setIsNip07Error(false);
      setUserPubkey(null);
      setRelayUrls([]);
      setKind10002Relays([]);
    }
  }, [isOpen]);

  const handlePost = useCallback(async () => {
    if (!content.trim()) {
      setError(t('dialogs.post.errorNoContent'));
      return;
    }

    if (relayUrls.length === 0) {
      setError(t('dialogs.post.errorNoRelays'));
      return;
    }

    if (!userPubkey) {
      setIsNip07Error(true);
      return;
    }

    setPosting(true);
    setError(null);

    try {
      // Build tags for reply if replyTo is provided
      const tags: string[][] = [];
      if (replyTo) {
        tags.push(['e', replyTo.event.id, '', 'reply']);
        tags.push(['p', replyTo.event.pubkey]);
      }

      // Create unsigned kind:1 event
      const unsignedEvent: UnsignedEvent = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: content.trim(),
      };

      // Sign the event using NIP-07
      let signedEvent;
      try {
        signedEvent = await signEvent(unsignedEvent);
      } catch {
        setError(t('dialogs.post.errorSigningRejected'));
        setPosting(false);
        return;
      }

      // Publish to relays
      const rxNostr = createRxNostr({ verifier });
      rxNostr.setDefaultRelays(relayUrls);

      let acknowledged = false;

      // Create a promise that resolves when at least one relay accepts
      const publishPromise = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(acknowledged);
        }, 10000);

        // Send the event and wait for OK responses
        rxNostr.send(signedEvent).subscribe({
          next: (packet) => {
            if (packet.ok) {
              acknowledged = true;
              clearTimeout(timeout);
              resolve(true);
            }
          },
          error: () => {
            // Continue trying other relays
          },
          complete: () => {
            clearTimeout(timeout);
            resolve(acknowledged);
          },
        });
      });

      const success = await publishPromise;

      if (!success) {
        setError(t('dialogs.post.errorUnknown'));
        setPosting(false);
        return;
      }

      // Success - close dialog
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dialogs.post.errorUnknown'));
    } finally {
      setPosting(false);
    }
  }, [content, relayUrls, userPubkey, onClose, t]);

  const handleRelayDialogSave = useCallback((relays: string[]) => {
    setRelayUrls(relays);
    setRelayDialogOpen(false);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  const handleOverlayMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setMouseDownOnOverlay(true);
    }
  }, []);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && mouseDownOnOverlay) {
      onClose();
    }
    setMouseDownOnOverlay(false);
  }, [mouseDownOnOverlay, onClose]);

  if (!isOpen) return null;

  const profile = userPubkey ? getCachedProfile(userPubkey) : null;

  return (
    <>
      <div className="dialog-overlay" onMouseDown={handleOverlayMouseDown} onClick={handleOverlayClick} onKeyDown={handleKeyDown}>
        <div className="dialog">
          <div className="dialog-header">
            <h2>{t('dialogs.post.title')}</h2>
            <button className="dialog-close" onClick={onClose}>×</button>
          </div>

          <div className="dialog-content">
            {/* Reply target display */}
            {replyTo && (
              <div className="dialog-reply-target">
                <div className="dialog-reply-header">
                  <img
                    className="dialog-reply-icon"
                    src={replyTo.profile?.picture || DEFAULT_AVATAR}
                    alt=""
                    onError={(e) => {
                      const img = e.target as HTMLImageElement;
                      img.src = DEFAULT_AVATAR;
                    }}
                  />
                  <div className="dialog-reply-names">
                    <span className="dialog-reply-display-name">
                      {replyTo.profile?.display_name || replyTo.profile?.name || formatNpub(replyTo.event.pubkey)}
                    </span>
                    <span className="dialog-reply-name">
                      @{replyTo.profile?.name || formatNpub(replyTo.event.pubkey)}
                    </span>
                  </div>
                </div>
                <div className="dialog-reply-content">
                  {replyTo.event.content}
                </div>
                {extractImageUrls(replyTo.event.content).length > 0 && (
                  <div className="dialog-reply-images">
                    {extractImageUrls(replyTo.event.content).map((url, idx) => (
                      <img key={idx} src={url} alt="" className="dialog-reply-image" />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Content textarea */}
            <div className="dialog-input-group">
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                rows={6}
                autoFocus
              />
            </div>

            {/* User's pubkey display */}
            {userPubkey && (
              <div className="dialog-user-info">
                <span className="user-info-label">{t('dialogs.post.yourPubkey')}:</span>
                <img src={profile?.picture || DEFAULT_AVATAR} alt="" className="user-icon" />
                <span className="user-name">
                  {profile?.name || formatNpub(userPubkey)}
                </span>
              </div>
            )}

            {/* Error message */}
            {isNip07Error && <Nip07ErrorMessage />}
            {error && !isNip07Error && <div className="dialog-error">{error}</div>}
          </div>

          <div className="dialog-footer">
            <button className="dialog-button" onClick={() => setRelayDialogOpen(true)}>
              {t('dialogs.post.relay')}
            </button>
            <button className="dialog-button" onClick={onClose}>
              {t('dialogs.cancel')}
            </button>
            <button
              className="dialog-button primary"
              onClick={handlePost}
              disabled={posting || !content.trim()}
            >
              {posting ? t('dialogs.post.posting') : t('dialogs.post.post')}
            </button>
          </div>
        </div>
      </div>

      {/* Relay Settings Dialog */}
      <RelaySettingsDialog
        isOpen={relayDialogOpen}
        onClose={() => setRelayDialogOpen(false)}
        onSave={handleRelayDialogSave}
        currentRelays={relayUrls}
        kind10002Relays={kind10002Relays}
      />
    </>
  );
}

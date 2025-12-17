import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { eventIdToNevent } from '../../nostr/types';
import './Dialog.css';

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
}

// Generate permalink URL from event ID (using nevent bech32 format)
export function generatePermalink(eventId: string): string {
  // Use the current origin for local development, or the production URL
  const baseUrl = window.location.origin + window.location.pathname;
  const nevent = eventIdToNevent(eventId);
  return `${baseUrl}?e=${nevent}`;
}

export function ShareDialog({ isOpen, onClose, eventId }: ShareDialogProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  // Track if mousedown started on overlay (for proper click-outside handling)
  const [mouseDownOnOverlay, setMouseDownOnOverlay] = useState(false);

  const permalink = generatePermalink(eventId);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(permalink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }, [permalink]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  const handleOverlayMouseDown = useCallback((e: React.MouseEvent) => {
    // Only set true if mousedown is directly on the overlay (not on dialog)
    if (e.target === e.currentTarget) {
      setMouseDownOnOverlay(true);
    }
  }, []);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    // Only close if both mousedown and click happened on overlay
    if (e.target === e.currentTarget && mouseDownOnOverlay) {
      onClose();
    }
    setMouseDownOnOverlay(false);
  }, [mouseDownOnOverlay, onClose]);

  if (!isOpen) return null;

  return (
    <div className="dialog-overlay" onMouseDown={handleOverlayMouseDown} onClick={handleOverlayClick} onKeyDown={handleKeyDown}>
      <div className="dialog share-dialog">
        <div className="dialog-header">
          <h2>{t('dialogs.share.title')}</h2>
          <button className="dialog-close" onClick={onClose}>×</button>
        </div>

        <div className="dialog-content">
          <div className="dialog-success-message">
            {t('dialogs.share.successMessage')}
          </div>

          <div className="dialog-input-group">
            <label>{t('dialogs.share.permalinkLabel')}</label>
            <input
              type="text"
              value={permalink}
              readOnly
              className="permalink-input"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
          </div>
        </div>

        <div className="dialog-footer">
          <button className="dialog-button" onClick={handleCopy}>
            {copied ? t('dialogs.share.copied') : t('dialogs.share.copy')}
          </button>
          <button className="dialog-button primary" onClick={onClose}>
            {t('dialogs.share.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}

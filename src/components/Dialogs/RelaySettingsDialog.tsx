import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './Dialog.css';

interface RelaySettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (relays: string[]) => void;
  currentRelays: string[];
  kind10002Relays: string[];
}

export function RelaySettingsDialog({
  isOpen,
  onClose,
  onSave,
  currentRelays,
  kind10002Relays,
}: RelaySettingsDialogProps) {
  const { t } = useTranslation();
  const [relayText, setRelayText] = useState('');
  const [mouseDownOnOverlay, setMouseDownOnOverlay] = useState(false);

  // Initialize relay text when dialog opens
  useEffect(() => {
    if (isOpen) {
      setRelayText(currentRelays.join('\n'));
    }
  }, [isOpen, currentRelays]);

  const handleResetToKind10002 = useCallback(() => {
    setRelayText(kind10002Relays.join('\n'));
  }, [kind10002Relays]);

  const handleSave = useCallback(() => {
    const relays = relayText
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0);
    onSave(relays);
  }, [relayText, onSave]);

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

  return (
    <div className="dialog-overlay" onMouseDown={handleOverlayMouseDown} onClick={handleOverlayClick} onKeyDown={handleKeyDown}>
      <div className="dialog">
        <div className="dialog-header">
          <h2>{t('dialogs.relay.title')}</h2>
          <button className="dialog-close" onClick={onClose}>×</button>
        </div>

        <div className="dialog-content">
          <div className="dialog-input-group">
            <label>{t('dialogs.relay.relayUrlsLabel')}</label>
            <textarea
              value={relayText}
              onChange={e => setRelayText(e.target.value)}
              rows={8}
              autoFocus
            />
          </div>
        </div>

        <div className="dialog-footer">
          <button className="dialog-button" onClick={handleResetToKind10002}>
            {t('dialogs.relay.kind10002')}
          </button>
          <button className="dialog-button" onClick={onClose}>
            {t('dialogs.cancel')}
          </button>
          <button className="dialog-button primary" onClick={handleSave}>
            {t('dialogs.relay.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}

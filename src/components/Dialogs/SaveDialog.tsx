import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import './Dialog.css';

type SaveDestination = 'local' | 'nostr' | 'file';
type NostrVisibility = 'public' | 'private';

interface SavedGraph {
  path: string;
  name: string;
  savedAt: number;
  isDirectory: boolean;
}

interface SaveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (destination: SaveDestination, path: string, options?: { visibility?: NostrVisibility; relayUrls?: string[] }) => Promise<void>;
  getSavedGraphs: (directory: string) => SavedGraph[];
  createDirectory: (path: string) => void;
}

export function SaveDialog({ isOpen, onClose, onSave, getSavedGraphs, createDirectory }: SaveDialogProps) {
  const { t } = useTranslation();
  const [destination, setDestination] = useState<SaveDestination>('local');
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [graphName, setGraphName] = useState('');
  const [visibility, setVisibility] = useState<NostrVisibility>('private');
  const [relayUrls, setRelayUrls] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fullPath = currentPath.length > 0 ? currentPath.join('/') : '';
  // Only get saved graphs for localStorage - Nostr will be implemented later
  // refreshKey is used to force re-fetch when a folder is created
  const items = useMemo(() => {
    return destination === 'local' ? getSavedGraphs(fullPath) : [];
  }, [destination, fullPath, getSavedGraphs, refreshKey]);

  const handleNavigate = useCallback((name: string) => {
    setCurrentPath(prev => [...prev, name]);
  }, []);

  const handleNavigateUp = useCallback(() => {
    setCurrentPath(prev => prev.slice(0, -1));
  }, []);

  const handleBreadcrumbClick = useCallback((index: number) => {
    setCurrentPath(prev => prev.slice(0, index));
  }, []);

  const handleSelectGraph = useCallback((name: string) => {
    setGraphName(name);
  }, []);

  const handleNewFolder = useCallback(() => {
    const folderName = prompt(t('dialogs.save.newFolderPrompt'));
    if (folderName && folderName.trim()) {
      const newPath = fullPath ? `${fullPath}/${folderName.trim()}` : folderName.trim();
      createDirectory(newPath);
      // Force refresh to show the new folder
      setRefreshKey(prev => prev + 1);
    }
  }, [fullPath, createDirectory, t]);

  const handleSave = useCallback(async () => {
    if (!graphName.trim()) {
      setError(t('dialogs.save.errorNoName'));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const savePath = fullPath ? `${fullPath}/${graphName.trim()}` : graphName.trim();
      const options = destination === 'nostr' ? {
        visibility,
        relayUrls: relayUrls.split('\n').filter(url => url.trim()),
      } : undefined;

      await onSave(destination, savePath, options);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dialogs.save.errorUnknown'));
    } finally {
      setSaving(false);
    }
  }, [graphName, fullPath, destination, visibility, relayUrls, onSave, onClose, t]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="dialog-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>{t('dialogs.save.title')}</h2>
          <button className="dialog-close" onClick={onClose}>×</button>
        </div>

        <div className="dialog-content">
          {/* Destination tabs */}
          <div className="dialog-tabs">
            <button
              className={`dialog-tab ${destination === 'local' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setDestination('local'); setCurrentPath([]); }}
            >
              LocalStorage
            </button>
            <button
              className={`dialog-tab ${destination === 'nostr' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setDestination('nostr'); setCurrentPath([]); }}
            >
              Nostr Relay
            </button>
            <button
              className={`dialog-tab ${destination === 'file' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setDestination('file'); }}
            >
              File
            </button>
          </div>

          {destination !== 'file' && (
            <>
              {/* Breadcrumb navigation */}
              <div className="dialog-breadcrumb">
                <span
                  className="breadcrumb-item clickable"
                  onClick={() => handleBreadcrumbClick(0)}
                >
                  root
                </span>
                {currentPath.map((dir, index) => (
                  <span key={index}>
                    <span className="breadcrumb-separator">/</span>
                    <span
                      className="breadcrumb-item clickable"
                      onClick={() => handleBreadcrumbClick(index + 1)}
                    >
                      {dir}
                    </span>
                  </span>
                ))}
              </div>

              {/* Directory browser */}
              <div className="dialog-browser">
                {currentPath.length > 0 && (
                  <div className="browser-item directory" onClick={handleNavigateUp}>
                    <span className="item-icon">📁</span>
                    <span className="item-name">..</span>
                  </div>
                )}
                {items.filter(item => item.isDirectory).map(item => (
                  <div
                    key={item.path}
                    className="browser-item directory"
                    onClick={() => handleNavigate(item.name)}
                  >
                    <span className="item-icon">📁</span>
                    <span className="item-name">{item.name}</span>
                  </div>
                ))}
                {items.filter(item => !item.isDirectory).map(item => (
                  <div
                    key={item.path}
                    className={`browser-item graph ${graphName === item.name ? 'selected' : ''}`}
                    onClick={() => handleSelectGraph(item.name)}
                  >
                    <span className="item-icon">📄</span>
                    <span className="item-name">{item.name}</span>
                    <span className="item-date">
                      {new Date(item.savedAt).toLocaleString()}
                    </span>
                  </div>
                ))}
                {items.length === 0 && currentPath.length === 0 && (
                  <div className="browser-empty">{t('dialogs.save.emptyDirectory')}</div>
                )}
              </div>
            </>
          )}

          {/* Name input */}
          <div className="dialog-input-group">
            <label>{t('dialogs.save.nameLabel')}</label>
            <input
              type="text"
              value={graphName}
              onChange={e => setGraphName(e.target.value)}
              placeholder={t('dialogs.save.namePlaceholder')}
            />
          </div>

          {/* Nostr-specific options */}
          {destination === 'nostr' && (
            <>
              <div className="dialog-input-group">
                <label>{t('dialogs.save.visibilityLabel')}</label>
                <div className="dialog-radio-group">
                  <label>
                    <input
                      type="radio"
                      name="visibility"
                      checked={visibility === 'public'}
                      onChange={() => setVisibility('public')}
                    />
                    Public
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="visibility"
                      checked={visibility === 'private'}
                      onChange={() => setVisibility('private')}
                    />
                    For yourself
                  </label>
                </div>
              </div>

              <div className="dialog-input-group">
                <label>{t('dialogs.save.relayUrlsLabel')}</label>
                <textarea
                  value={relayUrls}
                  onChange={e => setRelayUrls(e.target.value)}
                  placeholder={t('dialogs.save.relayUrlsPlaceholder')}
                  rows={3}
                />
              </div>
            </>
          )}

          {/* Error message */}
          {error && <div className="dialog-error">{error}</div>}
        </div>

        <div className="dialog-footer">
          <button className="dialog-button" onClick={onClose}>
            {t('dialogs.cancel')}
          </button>
          {destination !== 'file' && (
            <button className="dialog-button" onClick={handleNewFolder}>
              {t('dialogs.save.newFolder')}
            </button>
          )}
          <button
            className="dialog-button primary"
            onClick={handleSave}
            disabled={saving || !graphName.trim()}
          >
            {saving ? t('dialogs.save.saving') : t('dialogs.save.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

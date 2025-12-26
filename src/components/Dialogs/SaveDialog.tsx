import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getGraphsInDirectory, deleteGraphAtPath, deleteGraphsInDirectory } from '../../utils/localStorage';
import { isNip07Available, getPubkey } from '../../nostr/nip07';
import { loadGraphsFromNostr, getNostrItemsInDirectory, deleteGraphFromNostr, getProfileFromCache, fetchUserRelays, fetchAndCacheProfiles, type NostrGraphItem } from '../../nostr/graphStorage';
import { formatNpub } from '../../nostr/types';
import { Nip07ErrorMessage } from './Nip07ErrorMessage';
import { ShareDialog } from './ShareDialog';
import './Dialog.css';

type SaveDestination = 'local' | 'nostr' | 'file';
type NostrVisibility = 'public' | 'private';

interface SaveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (destination: SaveDestination, path: string, options?: { visibility?: NostrVisibility; relayUrls?: string[] }) => Promise<string | void>;
}

export function SaveDialog({ isOpen, onClose, onSave }: SaveDialogProps) {
  const { t } = useTranslation();
  const [destination, setDestination] = useState<SaveDestination>('local');
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [graphName, setGraphName] = useState('');
  const [visibility, setVisibility] = useState<NostrVisibility>('private');
  const [relayUrls, setRelayUrls] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNip07Error, setIsNip07Error] = useState(false);
  // Session-only directories (not persisted to localStorage)
  const [localDirectories, setLocalDirectories] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  // Track if mousedown started on overlay (for proper click-outside handling)
  const [mouseDownOnOverlay, setMouseDownOnOverlay] = useState(false);
  // Nostr state
  const [nostrGraphs, setNostrGraphs] = useState<NostrGraphItem[]>([]);
  const [nostrLoading, setNostrLoading] = useState(false);
  const [userPubkey, setUserPubkey] = useState<string | null>(null);
  // Share dialog state (for Nostr saves)
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [savedEventId, setSavedEventId] = useState<string | null>(null);

  // Refresh data when dialog opens
  useEffect(() => {
    if (isOpen) {
      setRefreshKey(prev => prev + 1);
    }
  }, [isOpen]);

  // Load user's pubkey, relay list, Nostr graphs, and fetch profiles when Nostr tab is selected
  useEffect(() => {
    if (isOpen && destination === 'nostr') {
      const loadNostrData = async () => {
        if (!isNip07Available()) {
          setIsNip07Error(true);
          return;
        }
        try {
          setNostrLoading(true);
          setError(null);
          const pubkey = await getPubkey();
          setUserPubkey(pubkey);
          // Fetch user's relay list from kind:10002
          const relays = await fetchUserRelays(pubkey);
          if (relays.length > 0) {
            setRelayUrls(relays.join('\n'));
          }
          // Fetch and cache profiles from relays for autocomplete
          fetchAndCacheProfiles(relays.length > 0 ? relays : undefined);
          const graphs = await loadGraphsFromNostr('mine');
          setNostrGraphs(graphs);
        } catch (e) {
          setError(e instanceof Error ? e.message : t('dialogs.save.errorUnknown'));
        } finally {
          setNostrLoading(false);
        }
      };
      loadNostrData();
    }
  }, [isOpen, destination, t]);

  const fullPath = currentPath.length > 0 ? currentPath.join('/') : '';
  // Get saved graphs with locally-created directories
  // Directories are derived from graph paths + session-only local directories
  const localItems = useMemo(() => {
    return destination === 'local' ? getGraphsInDirectory(fullPath, localDirectories) : [];
  }, [destination, fullPath, localDirectories, refreshKey]);

  // Get Nostr items for current directory (including session-only folders)
  const nostrItems = useMemo(() => {
    if (destination !== 'nostr') return [];
    const items = getNostrItemsInDirectory(nostrGraphs, fullPath, userPubkey);

    // Add session-only local directories
    const seenDirs = new Set(items.filter(i => i.isDirectory).map(i => i.name));
    for (const dir of localDirectories) {
      if (!fullPath && !dir.includes('/')) {
        // Top-level directory at root
        if (!seenDirs.has(dir)) {
          seenDirs.add(dir);
          items.push({
            path: dir,
            name: dir,
            createdAt: Math.floor(Date.now() / 1000),
            pubkey: '',
            isDirectory: true,
          });
        }
      } else if (fullPath && dir.startsWith(fullPath + '/')) {
        // Subdirectory within current directory
        const relativePath = dir.slice(fullPath.length + 1);
        if (!relativePath.includes('/')) {
          if (!seenDirs.has(relativePath)) {
            seenDirs.add(relativePath);
            items.push({
              path: dir,
              name: relativePath,
              createdAt: Math.floor(Date.now() / 1000),
              pubkey: '',
              isDirectory: true,
            });
          }
        }
      }
    }

    // Sort: directories first, then by name
    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return items;
  }, [destination, nostrGraphs, fullPath, userPubkey, localDirectories]);

  // Combined items for current destination
  const items = destination === 'local' ? localItems : nostrItems;

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

  const handleDeleteGraph = useCallback(async (e: React.MouseEvent, path: string, name: string, eventId?: string) => {
    e.stopPropagation();
    if (confirm(t('dialogs.load.confirmDeleteGraph', { name }))) {
      if (destination === 'local') {
        deleteGraphAtPath(path);
        setRefreshKey(prev => prev + 1);
      } else if (destination === 'nostr') {
        try {
          const relays = relayUrls.split('\n').filter(url => url.trim());
          await deleteGraphFromNostr(path, relays.length > 0 ? relays : undefined, eventId);
          // Reload Nostr graphs
          const graphs = await loadGraphsFromNostr('mine');
          setNostrGraphs(graphs);
        } catch (err) {
          setError(err instanceof Error ? err.message : t('dialogs.save.errorUnknown'));
        }
      }
      if (graphName === name) {
        setGraphName('');
      }
    }
  }, [t, graphName, destination, relayUrls]);

  const handleDeleteFolder = useCallback((e: React.MouseEvent, path: string, name: string) => {
    e.stopPropagation();
    if (confirm(t('dialogs.load.confirmDeleteFolder', { name }))) {
      deleteGraphsInDirectory(path);
      // Also remove from local directories if it was session-only
      setLocalDirectories(prev => prev.filter(d => d !== path && !d.startsWith(path + '/')));
      setRefreshKey(prev => prev + 1);
    }
  }, [t]);

  const handleNewFolder = useCallback(() => {
    const folderName = prompt(t('dialogs.save.newFolderPrompt'));
    if (folderName && folderName.trim()) {
      const newPath = fullPath ? `${fullPath}/${folderName.trim()}` : folderName.trim();
      // Add to session-only local directories
      setLocalDirectories(prev => [...prev, newPath]);
    }
  }, [fullPath, t]);

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

      const result = await onSave(destination, savePath, options);

      // For Nostr saves, show share dialog with event ID
      if (destination === 'nostr' && typeof result === 'string') {
        setSavedEventId(result);
        setShareDialogOpen(true);
        // Don't close the save dialog yet - let share dialog handle closing
      } else {
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dialogs.save.errorUnknown'));
    } finally {
      setSaving(false);
    }
  }, [graphName, fullPath, destination, visibility, relayUrls, onSave, onClose, t]);

  const handleShareDialogClose = useCallback(() => {
    setShareDialogOpen(false);
    setSavedEventId(null);
    onClose();
  }, [onClose]);

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

  // Show share dialog if we just saved to Nostr
  if (shareDialogOpen && savedEventId) {
    return (
      <ShareDialog
        isOpen={true}
        onClose={handleShareDialogClose}
        eventId={savedEventId}
      />
    );
  }

  return (
    <div className="dialog-overlay" onMouseDown={handleOverlayMouseDown} onClick={handleOverlayClick} onKeyDown={handleKeyDown}>
      <div className="dialog">
        <div className="dialog-header">
          <h2>{t('dialogs.save.title')}</h2>
          <button className="dialog-close" onClick={onClose}>×</button>
        </div>

        <div className="dialog-content">
          {/* Destination label and tabs */}
          <div className="dialog-destination-label">{t('dialogs.save.saveTo')}</div>
          <div className="dialog-tabs">
            <button
              className={`dialog-tab ${destination === 'local' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setDestination('local'); setCurrentPath([]); setIsNip07Error(false); setError(null); }}
            >
              Browser
            </button>
            <button
              className={`dialog-tab ${destination === 'nostr' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setDestination('nostr'); setCurrentPath([]); setIsNip07Error(false); setError(null); }}
            >
              Nostr Relay
            </button>
            <button
              className={`dialog-tab ${destination === 'file' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setDestination('file'); setIsNip07Error(false); setError(null); }}
            >
              File
            </button>
          </div>
          <div className="dialog-destination-description">
            {destination === 'local' && t('dialogs.save.browserDescription')}
            {destination === 'nostr' && t('dialogs.save.nostrDescription')}
            {destination === 'file' && t('dialogs.save.fileDescription')}
          </div>

          {destination !== 'file' && (
            <>
              {/* Breadcrumb navigation with path: caption */}
              <div className="dialog-breadcrumb">
                <span className="breadcrumb-label">path:</span>
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
                {nostrLoading && destination === 'nostr' ? (
                  <div className="browser-loading">
                    <span className="loading-spinner"></span>
                    {t('dialogs.save.loadingGraphs')}
                  </div>
                ) : (
                  <>
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
                        {destination === 'local' && (
                          <button
                            className="item-delete"
                            onClick={(e) => handleDeleteFolder(e, item.path, item.name)}
                            title={t('dialogs.load.deleteFolder')}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    {items.filter(item => !item.isDirectory).map(item => {
                      const timestamp = 'savedAt' in item ? item.savedAt : ('createdAt' in item ? (item as NostrGraphItem).createdAt * 1000 : 0);
                      const nostrItem = destination === 'nostr' ? item as NostrGraphItem : null;
                      const profile = nostrItem ? getProfileFromCache(nostrItem.pubkey) : null;
                      return (
                        <div
                          key={item.path}
                          className={`browser-item graph ${graphName === item.name ? 'selected' : ''}`}
                          onClick={() => handleSelectGraph(item.name)}
                        >
                          <span className="item-icon">📄</span>
                          <span className="item-name">{item.name}</span>
                          {/* Author info (Nostr only) */}
                          {nostrItem && (
                            <span className="item-author-info">
                              {profile?.picture ? (
                                <img src={profile.picture} alt="" className="item-author-picture" />
                              ) : (
                                <span className="item-author-picture-placeholder">👤</span>
                              )}
                              <span className="item-author-name">
                                {profile?.name || formatNpub(nostrItem.pubkey)}
                              </span>
                            </span>
                          )}
                          <span className="item-date">
                            {timestamp > 0 ? new Date(timestamp).toLocaleString() : ''}
                          </span>
                          <button
                            className="item-delete"
                            onClick={(e) => handleDeleteGraph(e, item.path, item.name, nostrItem?.event?.id)}
                            title={t('dialogs.load.deleteGraph')}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                    {items.length === 0 && currentPath.length === 0 && (
                      <div className="browser-empty">{t('dialogs.save.emptyDirectory')}</div>
                    )}
                  </>
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
                      checked={visibility === 'private'}
                      onChange={() => setVisibility('private')}
                    />
                    For yourself
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="visibility"
                      checked={visibility === 'public'}
                      onChange={() => setVisibility('public')}
                    />
                    Public
                  </label>
                </div>
                <div className="dialog-visibility-description">
                  {t('dialogs.save.visibilityDescription')}
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

              {/* User's info display with as: caption */}
              {userPubkey && (() => {
                const profile = getProfileFromCache(userPubkey);
                return (
                  <div className="dialog-user-info">
                    <span className="user-info-label">as:</span>
                    {profile?.picture ? (
                      <img src={profile.picture} alt="" className="user-icon" />
                    ) : (
                      <span className="user-icon-placeholder">👤</span>
                    )}
                    <span className="user-name">
                      {profile?.name || formatNpub(userPubkey)}
                    </span>
                  </div>
                );
              })()}
            </>
          )}

          {/* Error message */}
          {isNip07Error && <Nip07ErrorMessage />}
          {error && !isNip07Error && <div className="dialog-error">{error}</div>}
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

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getGraphsInDirectory, deleteGraphAtPath, deleteGraphsInDirectory } from '../../utils/localStorage';
import { isNip07Available, getPubkey } from '../../nostr/nip07';
import {
  loadGraphsFromNostr,
  getNostrItemsInDirectory,
  deleteGraphFromNostr,
  getProfileFromCache,
  getAllCachedProfiles,
  fetchUserRelays,
  fetchAndCacheProfiles,
  type NostrGraphItem
} from '../../nostr/graphStorage';
import { formatNpub, decodeBech32ToHex, isHex64 } from '../../nostr/types';
import { Nip07ErrorMessage } from './Nip07ErrorMessage';
import { generatePermalink } from './ShareDialog';
import './Dialog.css';

type LoadSource = 'local' | 'nostr' | 'file';
type NostrFilter = 'public' | 'mine' | 'by-author';

interface LoadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onLoad: (source: LoadSource, pathOrFile: string | File, options?: { pubkey?: string }) => Promise<void>;
}

export function LoadDialog({ isOpen, onClose, onLoad }: LoadDialogProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState<LoadSource>('local');
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [selectedGraph, setSelectedGraph] = useState<string | null>(null);
  const [selectedNostrGraph, setSelectedNostrGraph] = useState<NostrGraphItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNip07Error, setIsNip07Error] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Track if mousedown started on overlay (for proper click-outside handling)
  const [mouseDownOnOverlay, setMouseDownOnOverlay] = useState(false);

  // Nostr state
  const [nostrFilter, setNostrFilter] = useState<NostrFilter>('mine');
  const [authorInput, setAuthorInput] = useState('');
  const [authorPubkey, setAuthorPubkey] = useState<string | null>(null);
  const [nostrGraphs, setNostrGraphs] = useState<NostrGraphItem[]>([]);
  const [nostrLoading, setNostrLoading] = useState(false);
  const [userPubkey, setUserPubkey] = useState<string | null>(null);
  const [authorSuggestions, setAuthorSuggestions] = useState<Array<{ pubkey: string; name: string; picture?: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [relayUrls, setRelayUrls] = useState('');
  const [urlCopied, setUrlCopied] = useState(false);

  // Refresh data when dialog opens
  useEffect(() => {
    if (isOpen) {
      setRefreshKey(prev => prev + 1);
    }
  }, [isOpen]);

  // Load user's pubkey, relay list, and fetch profiles when Nostr tab is selected
  useEffect(() => {
    if (isOpen && source === 'nostr') {
      const loadUserData = async () => {
        let relays: string[] = [];
        if (isNip07Available()) {
          try {
            const pubkey = await getPubkey();
            setUserPubkey(pubkey);
            // Fetch user's relay list from kind:10002
            relays = await fetchUserRelays(pubkey);
            if (relays.length > 0) {
              setRelayUrls(relays.join('\n'));
            }
          } catch {
            // NIP-07 available but user denied
          }
        }
        // Fetch and cache profiles from relays for autocomplete
        fetchAndCacheProfiles(relays.length > 0 ? relays : undefined);
      };
      loadUserData();
    }
  }, [isOpen, source]);

  // Load Nostr graphs when filter or author changes
  useEffect(() => {
    if (isOpen && source === 'nostr') {
      const loadNostrGraphs = async () => {
        setNostrLoading(true);
        setError(null);
        setSelectedNostrGraph(null);
        setCurrentPath([]);

        try {
          if (nostrFilter === 'mine') {
            if (!isNip07Available()) {
              setIsNip07Error(true);
              setNostrGraphs([]);
              return;
            }
          }

          if (nostrFilter === 'by-author' && !authorPubkey) {
            setNostrGraphs([]);
            return;
          }

          // Pass relay URLs from the textarea to the query
          const relays = relayUrls.split('\n').filter(url => url.trim());
          const graphs = await loadGraphsFromNostr(
            nostrFilter,
            nostrFilter === 'by-author' ? authorPubkey! : undefined,
            relays.length > 0 ? relays : undefined
          );
          setNostrGraphs(graphs);
        } catch (e) {
          setError(e instanceof Error ? e.message : t('dialogs.load.errorUnknown'));
          setNostrGraphs([]);
        } finally {
          setNostrLoading(false);
        }
      };
      loadNostrGraphs();
    }
  }, [isOpen, source, nostrFilter, authorPubkey, relayUrls, t]);

  // Update author suggestions when input changes
  useEffect(() => {
    if (authorInput.length > 0) {
      const profiles = getAllCachedProfiles();
      const searchLower = authorInput.toLowerCase();
      const matches = profiles
        .filter(p => {
          // Search both name and display_name independently
          const displayName = p.profile.display_name || '';
          const name = p.profile.name || '';
          return displayName.toLowerCase().includes(searchLower) ||
            name.toLowerCase().includes(searchLower) ||
            p.pubkey.includes(authorInput) ||
            formatNpub(p.pubkey).includes(authorInput);
        })
        .slice(0, 10)
        .map(p => ({
          pubkey: p.pubkey,
          name: p.profile.name || formatNpub(p.pubkey),
          picture: p.profile.picture,
        }));
      setAuthorSuggestions(matches);
      setShowSuggestions(matches.length > 0);
    } else {
      setAuthorSuggestions([]);
      setShowSuggestions(false);
    }
  }, [authorInput]);

  const fullPath = currentPath.length > 0 ? currentPath.join('/') : '';

  // Get saved graphs - directories are derived from graph paths
  const localItems = useMemo(() => {
    return source === 'local' ? getGraphsInDirectory(fullPath) : [];
  }, [source, fullPath, refreshKey]);

  // Get Nostr items for current directory
  const nostrItems = useMemo(() => {
    if (source !== 'nostr') return [];

    // For 'by-author' filter, don't show items until an author is selected
    if (nostrFilter === 'by-author' && !authorPubkey) {
      return [];
    }

    const items = getNostrItemsInDirectory(nostrGraphs, fullPath, userPubkey);

    // When filter is 'mine' (For yourself), show only private items
    if (nostrFilter === 'mine') {
      return items.filter(item => {
        // Always show directories
        if (item.isDirectory) return true;
        // Show only 'For yourself' items (hide public items)
        return item.visibility !== 'public';
      });
    }

    // When filter is 'public', show only public items (hide all 'For yourself' items)
    if (nostrFilter === 'public') {
      return items.filter(item => {
        // Always show directories
        if (item.isDirectory) return true;
        // Show only public items (hide 'For yourself' items from everyone including myself)
        return item.visibility === 'public';
      });
    }

    // 'by-author' filter shows all items (both public and private)
    return items;
  }, [source, nostrGraphs, fullPath, userPubkey, nostrFilter, authorPubkey]);

  const items = source === 'local' ? localItems : [];

  const handleNavigate = useCallback((name: string) => {
    setCurrentPath(prev => [...prev, name]);
    setSelectedGraph(null);
    setSelectedNostrGraph(null);
  }, []);

  const handleNavigateUp = useCallback(() => {
    setCurrentPath(prev => prev.slice(0, -1));
    setSelectedGraph(null);
    setSelectedNostrGraph(null);
  }, []);

  const handleBreadcrumbClick = useCallback((index: number) => {
    setCurrentPath(prev => prev.slice(0, index));
    setSelectedGraph(null);
    setSelectedNostrGraph(null);
  }, []);

  const handleSelectGraph = useCallback((path: string) => {
    setSelectedGraph(path);
  }, []);

  const handleSelectNostrGraph = useCallback((item: NostrGraphItem) => {
    setSelectedNostrGraph(item);
  }, []);

  const handleDeleteGraph = useCallback(async (e: React.MouseEvent, path: string, name: string) => {
    e.stopPropagation();
    if (confirm(t('dialogs.load.confirmDeleteGraph', { name }))) {
      deleteGraphAtPath(path);
      setSelectedGraph(null);
      setRefreshKey(prev => prev + 1);
    }
  }, [t]);

  const handleDeleteNostrGraph = useCallback(async (e: React.MouseEvent, item: NostrGraphItem) => {
    e.stopPropagation();
    if (confirm(t('dialogs.load.confirmDeleteGraph', { name: item.name }))) {
      try {
        await deleteGraphFromNostr(item.path);
        // Reload graphs
        const graphs = await loadGraphsFromNostr(nostrFilter, nostrFilter === 'by-author' ? authorPubkey! : undefined);
        setNostrGraphs(graphs);
        setSelectedNostrGraph(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('dialogs.load.errorUnknown'));
      }
    }
  }, [t, nostrFilter, authorPubkey]);

  const handleDeleteFolder = useCallback((e: React.MouseEvent, path: string, name: string) => {
    e.stopPropagation();
    if (confirm(t('dialogs.load.confirmDeleteFolder', { name }))) {
      deleteGraphsInDirectory(path);
      setRefreshKey(prev => prev + 1);
    }
  }, [t]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  }, []);

  const handleChooseFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleAuthorSelect = useCallback((pubkey: string) => {
    setAuthorPubkey(pubkey);
    const profile = getProfileFromCache(pubkey);
    setAuthorInput(profile?.name || formatNpub(pubkey));
    setShowSuggestions(false);
  }, []);

  const handleAuthorInputChange = useCallback((value: string) => {
    setAuthorInput(value);
    // Try to parse as pubkey
    if (isHex64(value)) {
      setAuthorPubkey(value);
    } else {
      const decoded = decodeBech32ToHex(value);
      if (decoded && (decoded.type === 'npub' || decoded.type === 'nprofile')) {
        setAuthorPubkey(decoded.hex);
      } else {
        setAuthorPubkey(null);
      }
    }
  }, []);

  const handleLoad = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (source === 'file') {
        if (!selectedFile) {
          setError(t('dialogs.load.errorNoFile'));
          setLoading(false);
          return;
        }
        await onLoad(source, selectedFile);
      } else if (source === 'local') {
        if (!selectedGraph) {
          setError(t('dialogs.load.errorNoSelection'));
          setLoading(false);
          return;
        }
        await onLoad(source, selectedGraph);
      } else if (source === 'nostr') {
        if (!selectedNostrGraph) {
          setError(t('dialogs.load.errorNoSelection'));
          setLoading(false);
          return;
        }
        await onLoad(source, selectedNostrGraph.path, { pubkey: selectedNostrGraph.pubkey });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dialogs.load.errorUnknown'));
    } finally {
      setLoading(false);
    }
  }, [source, selectedGraph, selectedNostrGraph, selectedFile, onLoad, onClose, t]);

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

  // Check if load button should be enabled for Nostr
  const isNostrLoadEnabled = source === 'nostr' && selectedNostrGraph !== null;

  // Handle copy URL button click
  const handleCopyUrl = useCallback(async () => {
    if (!selectedNostrGraph?.event?.id) return;

    try {
      const permalink = generatePermalink(selectedNostrGraph.event.id);
      await navigator.clipboard.writeText(permalink);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy URL to clipboard:', err);
    }
  }, [selectedNostrGraph]);

  if (!isOpen) return null;

  return (
    <div className="dialog-overlay" onMouseDown={handleOverlayMouseDown} onClick={handleOverlayClick} onKeyDown={handleKeyDown}>
      <div className="dialog">
        <div className="dialog-header">
          <h2>{t('dialogs.load.title')}</h2>
          <button className="dialog-close" onClick={onClose}>×</button>
        </div>

        <div className="dialog-content">
          {/* Source label and tabs */}
          <div className="dialog-destination-label">{t('dialogs.load.loadFrom')}</div>
          <div className="dialog-tabs">
            <button
              className={`dialog-tab ${source === 'local' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setSource('local'); setCurrentPath([]); setSelectedGraph(null); setIsNip07Error(false); setError(null); }}
            >
              Browser
            </button>
            <button
              className={`dialog-tab ${source === 'nostr' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setSource('nostr'); setCurrentPath([]); setSelectedNostrGraph(null); setIsNip07Error(false); setError(null); }}
            >
              Nostr Relay
            </button>
            <button
              className={`dialog-tab ${source === 'file' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setSource('file'); setSelectedFile(null); setIsNip07Error(false); setError(null); }}
            >
              File
            </button>
          </div>
          <div className="dialog-destination-description">
            {source === 'nostr' && t('dialogs.load.nostrDescription')}
            {source === 'local' && t('dialogs.load.browserDescription')}
            {source === 'file' && t('dialogs.load.fileDescription')}
          </div>

          {source === 'nostr' && (
            <>
              {/* Relay URLs */}
              <div className="dialog-input-group">
                <label>{t('dialogs.load.relayUrlsLabel')}</label>
                <textarea
                  value={relayUrls}
                  onChange={e => setRelayUrls(e.target.value)}
                  placeholder={t('dialogs.load.relayUrlsPlaceholder')}
                  rows={3}
                />
              </div>

              {/* Visibility filter */}
              <div className="dialog-input-group">
                <label>{t('dialogs.load.filterLabel')}</label>
                <div className="dialog-radio-group">
                  <label>
                    <input
                      type="radio"
                      name="nostrFilter"
                      checked={nostrFilter === 'mine'}
                      onChange={() => setNostrFilter('mine')}
                    />
                    For yourself
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="nostrFilter"
                      checked={nostrFilter === 'public'}
                      onChange={() => setNostrFilter('public')}
                    />
                    Public
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="nostrFilter"
                      checked={nostrFilter === 'by-author'}
                      onChange={() => setNostrFilter('by-author')}
                    />
                    By author
                  </label>
                </div>
              </div>

              {/* Author input (shown when "By author" selected) */}
              {nostrFilter === 'by-author' && (
                <div className="dialog-input-group">
                  <label>{t('dialogs.load.authorLabel')}</label>
                  <div className="author-autocomplete">
                    <input
                      type="text"
                      value={authorInput}
                      onChange={e => handleAuthorInputChange(e.target.value)}
                      onFocus={() => authorSuggestions.length > 0 && setShowSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                      placeholder={t('dialogs.load.authorPlaceholder')}
                    />
                    {showSuggestions && authorSuggestions.length > 0 && (
                      <div className="author-suggestions">
                        {authorSuggestions.map(s => (
                          <div
                            key={s.pubkey}
                            className="author-suggestion"
                            onClick={() => handleAuthorSelect(s.pubkey)}
                          >
                            {s.picture ? (
                              <img src={s.picture} alt="" className="author-picture" />
                            ) : (
                              <span className="author-picture-placeholder">👤</span>
                            )}
                            <span className="author-name">{s.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

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

              {/* Nostr directory browser */}
              <div className="dialog-browser">
                {nostrLoading ? (
                  <div className="browser-loading">
                    <span className="loading-spinner"></span>
                    {t('dialogs.load.loadingGraphs')}
                  </div>
                ) : (
                  <>
                    {currentPath.length > 0 && (
                      <div className="browser-item directory" onClick={handleNavigateUp}>
                        <span className="item-icon">📁</span>
                        <span className="item-name">..</span>
                      </div>
                    )}
                    {nostrItems.filter(item => item.isDirectory).map(item => (
                      <div
                        key={item.path}
                        className="browser-item directory"
                        onClick={() => handleNavigate(item.name)}
                      >
                        <span className="item-icon">📁</span>
                        <span className="item-name">{item.name}</span>
                      </div>
                    ))}
                    {nostrItems.filter(item => !item.isDirectory).map(item => {
                      const profile = getProfileFromCache(item.pubkey);
                      const isOwn = item.pubkey === userPubkey;
                      return (
                        <div
                          key={item.path}
                          className={`browser-item graph ${selectedNostrGraph?.path === item.path ? 'selected' : ''}`}
                          onClick={() => handleSelectNostrGraph(item)}
                        >
                          <span className="item-icon">📄</span>
                          <span className="item-name">{item.name}</span>
                          {/* Author info */}
                          <span className="item-author-info">
                            {profile?.picture ? (
                              <img src={profile.picture} alt="" className="item-author-picture" />
                            ) : (
                              <span className="item-author-picture-placeholder">👤</span>
                            )}
                            <span className="item-author-name">
                              {profile?.name || formatNpub(item.pubkey)}
                            </span>
                          </span>
                          <span className="item-date">
                            {item.createdAt > 0 ? new Date(item.createdAt * 1000).toLocaleString() : ''}
                          </span>
                          {/* Delete button (only for own graphs) */}
                          {isOwn && (
                            <button
                              className="item-delete"
                              onClick={(e) => handleDeleteNostrGraph(e, item)}
                              title={t('dialogs.load.deleteGraph')}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {nostrItems.length === 0 && !nostrLoading && (
                      <div className="browser-empty">{t('dialogs.load.emptyDirectory')}</div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {source === 'local' && (
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
                    <button
                      className="item-delete"
                      onClick={(e) => handleDeleteFolder(e, item.path, item.name)}
                      title={t('dialogs.load.deleteFolder')}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {items.filter(item => !item.isDirectory).map(item => (
                  <div
                    key={item.path}
                    className={`browser-item graph ${selectedGraph === item.path ? 'selected' : ''}`}
                    onClick={() => handleSelectGraph(item.path)}
                  >
                    <span className="item-icon">📄</span>
                    <span className="item-name">{item.name}</span>
                    <span className="item-date">
                      {new Date(item.savedAt).toLocaleString()}
                    </span>
                    <button
                      className="item-delete"
                      onClick={(e) => handleDeleteGraph(e, item.path, item.name)}
                      title={t('dialogs.load.deleteGraph')}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="browser-empty">{t('dialogs.load.emptyDirectory')}</div>
                )}
              </div>
            </>
          )}

          {source === 'file' && (
            <div className="dialog-file-picker">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".json"
                style={{ display: 'none' }}
              />
              <button className="dialog-button" onClick={handleChooseFile}>
                {t('dialogs.load.chooseFile')}
              </button>
              {selectedFile && (
                <span className="selected-file">{selectedFile.name}</span>
              )}
            </div>
          )}

          {/* Error message */}
          {isNip07Error && <Nip07ErrorMessage />}
          {error && !isNip07Error && <div className="dialog-error">{error}</div>}
        </div>

        <div className="dialog-footer">
          <button className="dialog-button" onClick={onClose}>
            {t('dialogs.cancel')}
          </button>
          {source === 'nostr' && (
            <button
              className="dialog-button"
              onClick={handleCopyUrl}
              disabled={!selectedNostrGraph?.event?.id}
            >
              {urlCopied ? t('dialogs.load.urlCopied') : t('dialogs.load.copyUrl')}
            </button>
          )}
          <button
            className="dialog-button primary"
            onClick={handleLoad}
            disabled={loading || (source === 'file' ? !selectedFile : (source === 'local' ? !selectedGraph : !isNostrLoadEnabled))}
          >
            {loading ? t('dialogs.load.loading') : t('dialogs.load.load')}
          </button>
        </div>
      </div>
    </div>
  );
}

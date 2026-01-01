import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getGraphsInDirectory, deleteGraphAtPath, deleteGraphsInDirectory } from '../../utils/localStorage';
import { isNip07Available, getPubkey } from '../../nostr/nip07';
import {
  loadGraphsFromNostr,
  getNostrItemsInDirectory,
  deleteGraphFromNostr,
  fetchUserRelayList,
  fetchAndCacheProfiles,
  refreshGraphsCache,
  type NostrGraphItem
} from '../../nostr/graphStorage';
import { getCachedProfile, getAllCachedProfiles } from '../../nostr/profileCache';
import { formatNpub, decodeBech32ToHex, isHex64 } from '../../nostr/types';
import { Nip07ErrorMessage } from './Nip07ErrorMessage';
import { generatePermalink } from './ShareDialog';
import './Dialog.css';

const DEFAULT_AVATAR = `${import.meta.env.BASE_URL}mojimoji-icon.png`;

type LoadSource = 'local' | 'nostr' | 'file';

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

  // Nostr filter state (checkboxes)
  const [filterPersonal, setFilterPersonal] = useState(true);
  const [filterPublic, setFilterPublic] = useState(true);
  const [ownerMe, setOwnerMe] = useState(true);
  const [ownerOthers, setOwnerOthers] = useState(false);
  const [particularUserOnly, setParticularUserOnly] = useState(false);
  const [authorInput, setAuthorInput] = useState('');
  const [authorPubkey, setAuthorPubkey] = useState<string | null>(null);
  const [nostrGraphs, setNostrGraphs] = useState<NostrGraphItem[]>([]);
  const [nostrLoading, setNostrLoading] = useState(false);
  const [userPubkey, setUserPubkey] = useState<string | null>(null);
  const [authorSuggestions, setAuthorSuggestions] = useState<Array<{ pubkey: string; name: string; picture?: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [relayUrls, setRelayUrls] = useState('');
  const [urlCopied, setUrlCopied] = useState(false);
  const [useCompactLayout, setUseCompactLayout] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);

  // Check browser-item width after render and on window resize
  useEffect(() => {
    if (source !== 'nostr' || nostrLoading) return;

    const checkLayout = () => {
      const itemEl = itemRef.current;
      if (!itemEl) return;
      const itemWidth = itemEl.offsetWidth;
      setUseCompactLayout(itemWidth < 500);
    };

    // Use requestAnimationFrame for earliest possible detection after render
    const rafId = requestAnimationFrame(checkLayout);

    // Re-check on window resize
    window.addEventListener('resize', checkLayout);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', checkLayout);
    };
  }, [source, nostrLoading, nostrGraphs]);

  // Refresh data when dialog opens
  useEffect(() => {
    if (isOpen) {
      setRefreshKey(prev => prev + 1);
      // Reset layout detection when dialog opens
      setUseCompactLayout(false);
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
            relays = await fetchUserRelayList();
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

  // Track previous relay URLs to detect changes
  const prevRelayUrlsRef = useRef<string>('');

  // Load Nostr graphs when source or author changes
  useEffect(() => {
    if (isOpen && source === 'nostr') {
      const loadNostrGraphs = async () => {
        setNostrLoading(true);
        setError(null);
        setSelectedNostrGraph(null);
        // Keep current directory path when filter changes

        try {
          // If particularUserOnly is checked but no author selected, show empty
          if (particularUserOnly && !authorPubkey) {
            setNostrGraphs([]);
            setNostrLoading(false);
            return;
          }

          const relays = relayUrls.split('\n').filter(url => url.trim());

          // Check if relay URLs have changed - if so, refresh the cache
          const currentRelayKey = relays.sort().join(',');
          if (currentRelayKey !== prevRelayUrlsRef.current) {
            prevRelayUrlsRef.current = currentRelayKey;
            // Refresh cache with new relay URLs
            await refreshGraphsCache(relays.length > 0 ? relays : undefined);
          }

          if (particularUserOnly) {
            // Fetch graphs by specific author
            const graphs = await loadGraphsFromNostr(
              'by-author',
              authorPubkey!,
              relays.length > 0 ? relays : undefined
            );
            setNostrGraphs(graphs);
          } else {
            // Fetch all graphs from cache, filtering is done client-side
            const graphs = await loadGraphsFromNostr(
              'all',
              undefined,
              relays.length > 0 ? relays : undefined
            );
            setNostrGraphs(graphs);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : t('dialogs.load.errorUnknown'));
          setNostrGraphs([]);
        } finally {
          setNostrLoading(false);
        }
      };
      loadNostrGraphs();
    }
  }, [isOpen, source, particularUserOnly, authorPubkey, relayUrls, t]);

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

    // For particularUserOnly, don't show items until an author is selected
    if (particularUserOnly && !authorPubkey) {
      return [];
    }

    const items = getNostrItemsInDirectory(nostrGraphs, fullPath, userPubkey);

    // Filter by visibility and owner
    return items.filter(item => {
      // Always show directories
      if (item.isDirectory) return true;

      // Filter by owner (who created the graph)
      const isMine = item.pubkey === userPubkey;
      const isOthers = item.pubkey !== userPubkey;

      // Check owner filter (skip if particularUserOnly since we already fetched specific author)
      if (!particularUserOnly) {
        if (ownerMe && ownerOthers) {
          // Show both mine and others
        } else if (ownerMe && !ownerOthers) {
          // Show only mine
          if (!isMine) return false;
        } else if (!ownerMe && ownerOthers) {
          // Show only others
          if (!isOthers) return false;
        } else {
          // Neither checked - show nothing
          return false;
        }
      }

      // Filter by visibility (public flag)
      const isPublic = item.visibility === 'public';
      const isPersonal = item.visibility !== 'public';

      if (filterPersonal && filterPublic) {
        // Show both
        return true;
      } else if (filterPersonal && !filterPublic) {
        // Show only personal
        return isPersonal;
      } else if (!filterPersonal && filterPublic) {
        // Show only public
        return isPublic;
      } else {
        // Neither checked - show nothing
        return false;
      }
    });
  }, [source, nostrGraphs, fullPath, userPubkey, filterPersonal, filterPublic, ownerMe, ownerOthers, particularUserOnly, authorPubkey]);

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
        await deleteGraphFromNostr(item.path, undefined, item.event?.id);
        // Reload graphs
        const relays = relayUrls.split('\n').filter(url => url.trim());

        if (particularUserOnly && authorPubkey) {
          const graphs = await loadGraphsFromNostr('by-author', authorPubkey, relays.length > 0 ? relays : undefined);
          setNostrGraphs(graphs);
        } else {
          const graphs = await loadGraphsFromNostr('all', undefined, relays.length > 0 ? relays : undefined);
          setNostrGraphs(graphs);
        }

        setSelectedNostrGraph(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('dialogs.load.errorUnknown'));
      }
    }
  }, [t, particularUserOnly, authorPubkey, relayUrls]);

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
    const profile = getCachedProfile(pubkey);
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
    if (!selectedNostrGraph) return;

    try {
      // Pass read relay hints for naddr
      const readRelayHints = relayUrls.split('\n').filter(url => url.trim());
      const permalink = generatePermalink(selectedNostrGraph.pubkey, selectedNostrGraph.path, readRelayHints);
      await navigator.clipboard.writeText(permalink);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy URL to clipboard:', err);
    }
  }, [selectedNostrGraph, relayUrls]);

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
              {t('dialogs.tabs.browser')}
            </button>
            <button
              className={`dialog-tab ${source === 'nostr' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setSource('nostr'); setCurrentPath([]); setSelectedNostrGraph(null); setIsNip07Error(false); setError(null); }}
            >
              {t('dialogs.tabs.nostr')}
            </button>
            <button
              className={`dialog-tab ${source === 'file' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setSource('file'); setSelectedFile(null); setIsNip07Error(false); setError(null); }}
            >
              {t('dialogs.tabs.file')}
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

              {/* Visibility filter (checkboxes) */}
              <div className="dialog-input-group">
                <label>{t('dialogs.load.filterLabel')}</label>
                <div className="dialog-checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={filterPersonal}
                      onChange={(e) => setFilterPersonal(e.target.checked)}
                    />
                    {t('dialogs.visibility.mine')}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={filterPublic}
                      onChange={(e) => setFilterPublic(e.target.checked)}
                    />
                    {t('dialogs.visibility.public')}
                  </label>
                </div>
              </div>

              {/* Owner filter (checkboxes) */}
              <div className="dialog-input-group">
                <label>{t('dialogs.load.ownerLabel')}</label>
                <div className="dialog-checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={ownerMe}
                      disabled={particularUserOnly}
                      onChange={(e) => setOwnerMe(e.target.checked)}
                    />
                    {t('dialogs.load.ownerMe')}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={ownerOthers}
                      disabled={particularUserOnly}
                      onChange={(e) => setOwnerOthers(e.target.checked)}
                    />
                    {t('dialogs.load.ownerOthers')}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={particularUserOnly}
                      onChange={(e) => {
                        setParticularUserOnly(e.target.checked);
                        if (e.target.checked) {
                          setOwnerMe(false);
                          setOwnerOthers(false);
                        }
                      }}
                    />
                    {t('dialogs.load.particularUserOnly')}
                  </label>
                </div>
              </div>

              {/* Author input (shown when "particular user only" is checked) */}
              {particularUserOnly && (
                <div className="dialog-input-group">
                  <label>{t('dialogs.load.particularUserLabel')}</label>
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
                            <img src={s.picture || DEFAULT_AVATAR} alt="" className="author-picture" />
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
                    {nostrItems.filter(item => !item.isDirectory).map((item, index) => {
                      const profile = getCachedProfile(item.pubkey);
                      const isOwn = item.pubkey === userPubkey;
                      const isFirst = index === 0;
                      return (
                        <div
                          key={item.path}
                          ref={isFirst ? itemRef : undefined}
                          className={`browser-item graph ${selectedNostrGraph?.path === item.path ? 'selected' : ''} ${useCompactLayout ? 'compact' : ''}`}
                          onClick={() => handleSelectNostrGraph(item)}
                        >
                          {useCompactLayout ? (
                            <table className="compact-table">
                              <tbody>
                                <tr>
                                  <td className="compact-cell-icon"><span className="item-icon">📄</span></td>
                                  <td className="compact-cell-main">
                                    <span className="item-name">{item.name}</span>
                                    {item.visibility && (
                                      <span className={`item-visibility ${item.visibility}`}>
                                        {item.visibility === 'public' ? 'public' : 'personal'}
                                      </span>
                                    )}
                                  </td>
                                  {isOwn && (
                                    <td className="compact-cell-delete" rowSpan={2}>
                                      <button
                                        className="item-delete"
                                        onClick={(e) => handleDeleteNostrGraph(e, item)}
                                        title={t('dialogs.load.deleteGraph')}
                                      >
                                        ×
                                      </button>
                                    </td>
                                  )}
                                </tr>
                                <tr>
                                  <td className="compact-cell-icon">
                                    <img src={profile?.picture || DEFAULT_AVATAR} alt="" className="item-author-picture" />
                                  </td>
                                  <td className="compact-cell-main">
                                    <span className="item-author-name">
                                      {profile?.name || formatNpub(item.pubkey)}
                                    </span>
                                    <span className="item-date">
                                      {item.createdAt > 0 ? new Date(item.createdAt * 1000).toLocaleString() : ''}
                                    </span>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          ) : (
                            <>
                              <span className="item-icon">📄</span>
                              <span className="item-name">{item.name}</span>
                              {item.visibility && (
                                <span className={`item-visibility ${item.visibility}`}>
                                  {item.visibility === 'public' ? 'public' : 'for yourself'}
                                </span>
                              )}
                              <span className="item-author-info">
                                <img src={profile?.picture || DEFAULT_AVATAR} alt="" className="item-author-picture" />
                                <span className="item-author-name">
                                  {profile?.name || formatNpub(item.pubkey)}
                                </span>
                              </span>
                              <span className="item-date">
                                {item.createdAt > 0 ? new Date(item.createdAt * 1000).toLocaleString() : ''}
                              </span>
                              {isOwn && (
                                <button
                                  className="item-delete"
                                  onClick={(e) => handleDeleteNostrGraph(e, item)}
                                  title={t('dialogs.load.deleteGraph')}
                                >
                                  ×
                                </button>
                              )}
                            </>
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
              disabled={!selectedNostrGraph}
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

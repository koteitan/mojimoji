import { useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getGraphsInDirectory, deleteGraphAtPath, deleteGraphsInDirectory } from '../../utils/localStorage';
import './Dialog.css';

type LoadSource = 'local' | 'nostr' | 'file';

interface LoadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onLoad: (source: LoadSource, pathOrFile: string | File) => Promise<void>;
}

export function LoadDialog({ isOpen, onClose, onLoad }: LoadDialogProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState<LoadSource>('local');
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [selectedGraph, setSelectedGraph] = useState<string | null>(null);
  const [pubkeyInput, setPubkeyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fullPath = currentPath.length > 0 ? currentPath.join('/') : '';
  // Get saved graphs - directories are derived from graph paths
  const items = useMemo(() => {
    return source === 'local' ? getGraphsInDirectory(fullPath) : [];
  }, [source, fullPath, refreshKey]);

  const handleNavigate = useCallback((name: string) => {
    setCurrentPath(prev => [...prev, name]);
    setSelectedGraph(null);
  }, []);

  const handleNavigateUp = useCallback(() => {
    setCurrentPath(prev => prev.slice(0, -1));
    setSelectedGraph(null);
  }, []);

  const handleBreadcrumbClick = useCallback((index: number) => {
    setCurrentPath(prev => prev.slice(0, index));
    setSelectedGraph(null);
  }, []);

  const handleSelectGraph = useCallback((path: string) => {
    setSelectedGraph(path);
  }, []);

  const handleDeleteGraph = useCallback((e: React.MouseEvent, path: string, name: string) => {
    e.stopPropagation();
    if (confirm(t('dialogs.load.confirmDeleteGraph', { name }))) {
      deleteGraphAtPath(path);
      setSelectedGraph(null);
      setRefreshKey(prev => prev + 1);
    }
  }, [t]);

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
        // TODO: Implement Nostr load
        setError('Nostr load not yet implemented');
        setLoading(false);
        return;
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dialogs.load.errorUnknown'));
    } finally {
      setLoading(false);
    }
  }, [source, selectedGraph, selectedFile, onLoad, onClose, t]);

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
          <h2>{t('dialogs.load.title')}</h2>
          <button className="dialog-close" onClick={onClose}>×</button>
        </div>

        <div className="dialog-content">
          {/* Source label and tabs */}
          <div className="dialog-destination-label">{t('dialogs.load.loadFrom')}</div>
          <div className="dialog-tabs">
            <button
              className={`dialog-tab ${source === 'local' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setSource('local'); setCurrentPath([]); setSelectedGraph(null); }}
            >
              Browser
            </button>
            <button
              className={`dialog-tab ${source === 'nostr' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setSource('nostr'); setCurrentPath([]); setSelectedGraph(null); }}
            >
              Nostr Relay
            </button>
            <button
              className={`dialog-tab ${source === 'file' ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setSource('file'); setSelectedFile(null); }}
            >
              File
            </button>
          </div>
          <div className="dialog-destination-description">
            {source === 'local' && t('dialogs.load.browserDescription')}
            {source === 'nostr' && t('dialogs.load.nostrDescription')}
            {source === 'file' && t('dialogs.load.fileDescription')}
          </div>

          {source === 'nostr' && (
            <>
              {/* Pubkey input */}
              <div className="dialog-input-group">
                <label>{t('dialogs.load.pubkeyLabel')}</label>
                <input
                  type="text"
                  value={pubkeyInput}
                  onChange={e => setPubkeyInput(e.target.value)}
                  placeholder={t('dialogs.load.pubkeyPlaceholder')}
                />
              </div>

              {/* Nostr not implemented message */}
              <div className="browser-empty">Nostr relay loading is not yet implemented</div>
            </>
          )}

          {source === 'local' && (
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
          {error && <div className="dialog-error">{error}</div>}
        </div>

        <div className="dialog-footer">
          <button className="dialog-button" onClick={onClose}>
            {t('dialogs.cancel')}
          </button>
          <button
            className="dialog-button primary"
            onClick={handleLoad}
            disabled={loading || (source === 'file' ? !selectedFile : (source === 'local' ? !selectedGraph : true))}
          >
            {loading ? t('dialogs.load.loading') : t('dialogs.load.load')}
          </button>
        </div>
      </div>
    </div>
  );
}

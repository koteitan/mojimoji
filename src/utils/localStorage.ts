// Auto-save key (current working graph)
const AUTO_SAVE_KEY = 'mojimoji-graph';

// Manual saves key (array of saved graphs)
const SAVED_GRAPHS_KEY = 'mojimoji-saved-graphs';

export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

export interface GraphData {
  nodes: unknown[];
  connections: unknown[];
  viewTransform?: ViewTransform;
}

export interface SavedGraphEntry {
  path: string;
  data: GraphData;
  savedAt: number;
}

export interface SavedGraphItem {
  path: string;
  name: string;
  savedAt: number;
  isDirectory: boolean;
}

// ============================================
// Auto-save functions (current working graph)
// ============================================

export function saveGraph(data: GraphData): void {
  try {
    localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save graph to localStorage:', e);
  }
}

export function loadGraph(): GraphData | null {
  try {
    const data = localStorage.getItem(AUTO_SAVE_KEY);
    if (data) {
      return JSON.parse(data) as GraphData;
    }
  } catch (e) {
    console.error('Failed to load graph from localStorage:', e);
  }
  return null;
}

export function clearGraph(): void {
  try {
    localStorage.removeItem(AUTO_SAVE_KEY);
  } catch (e) {
    console.error('Failed to clear graph from localStorage:', e);
  }
}

// ============================================
// Manual save functions (saved graphs with directories)
// ============================================

function getSavedGraphsData(): SavedGraphEntry[] {
  try {
    const data = localStorage.getItem(SAVED_GRAPHS_KEY);
    if (data) {
      return JSON.parse(data) as SavedGraphEntry[];
    }
  } catch (e) {
    console.error('Failed to load saved graphs:', e);
  }
  return [];
}

function setSavedGraphsData(entries: SavedGraphEntry[]): void {
  try {
    localStorage.setItem(SAVED_GRAPHS_KEY, JSON.stringify(entries));
  } catch (e) {
    console.error('Failed to save graphs:', e);
  }
}

// Save a graph to a specific path
export function saveGraphToPath(path: string, data: GraphData): void {
  const entries = getSavedGraphsData();
  const existingIndex = entries.findIndex(e => e.path === path);

  const newEntry: SavedGraphEntry = {
    path,
    data,
    savedAt: Date.now(),
  };

  if (existingIndex >= 0) {
    entries[existingIndex] = newEntry;
  } else {
    entries.push(newEntry);
  }

  setSavedGraphsData(entries);
}

// Load a graph from a specific path
export function loadGraphFromPath(path: string): GraphData | null {
  const entries = getSavedGraphsData();
  const entry = entries.find(e => e.path === path);
  return entry?.data || null;
}

// Delete a graph at a specific path
export function deleteGraphAtPath(path: string): void {
  const entries = getSavedGraphsData();
  const filtered = entries.filter(e => e.path !== path);
  setSavedGraphsData(filtered);
}

// Key for storing explicit directories
const SAVED_DIRECTORIES_KEY = 'mojimoji-saved-directories';

function getSavedDirectories(): string[] {
  try {
    const data = localStorage.getItem(SAVED_DIRECTORIES_KEY);
    if (data) {
      return JSON.parse(data) as string[];
    }
  } catch (e) {
    console.error('Failed to load saved directories:', e);
  }
  return [];
}

function setSavedDirectories(dirs: string[]): void {
  try {
    localStorage.setItem(SAVED_DIRECTORIES_KEY, JSON.stringify(dirs));
  } catch (e) {
    console.error('Failed to save directories:', e);
  }
}

// Create an empty directory
export function createDirectory(path: string): void {
  const dirs = getSavedDirectories();
  if (!dirs.includes(path)) {
    dirs.push(path);
    setSavedDirectories(dirs);
  }
}

// Get list of graphs and directories in a directory
export function getGraphsInDirectory(directory: string): SavedGraphItem[] {
  const entries = getSavedGraphsData();
  const explicitDirs = getSavedDirectories();
  const prefix = directory ? `${directory}/` : '';
  const items: SavedGraphItem[] = [];
  const seenDirs = new Set<string>();

  // Add explicitly created directories
  for (const dir of explicitDirs) {
    if (!directory && !dir.includes('/')) {
      // Top-level directory at root
      if (!seenDirs.has(dir)) {
        seenDirs.add(dir);
        items.push({
          path: dir,
          name: dir,
          savedAt: Date.now(),
          isDirectory: true,
        });
      }
    } else if (directory && dir.startsWith(prefix)) {
      // Subdirectory within current directory
      const relativePath = dir.slice(prefix.length);
      if (!relativePath.includes('/')) {
        // Direct child directory
        if (!seenDirs.has(dir)) {
          seenDirs.add(dir);
          items.push({
            path: dir,
            name: relativePath,
            savedAt: Date.now(),
            isDirectory: true,
          });
        }
      } else {
        // Nested subdirectory - add only the immediate child
        const subDir = relativePath.split('/')[0];
        const fullSubDirPath = prefix + subDir;
        if (!seenDirs.has(fullSubDirPath)) {
          seenDirs.add(fullSubDirPath);
          items.push({
            path: fullSubDirPath,
            name: subDir,
            savedAt: Date.now(),
            isDirectory: true,
          });
        }
      }
    } else if (!directory && dir.includes('/')) {
      // Nested directory at root - add only the top-level part
      const topDir = dir.split('/')[0];
      if (!seenDirs.has(topDir)) {
        seenDirs.add(topDir);
        items.push({
          path: topDir,
          name: topDir,
          savedAt: Date.now(),
          isDirectory: true,
        });
      }
    }
  }

  for (const entry of entries) {
    // Check if this entry is in the specified directory
    if (directory && !entry.path.startsWith(prefix)) {
      continue;
    }
    if (!directory && entry.path.includes('/')) {
      // Entry is in a subdirectory, not root
      const topDir = entry.path.split('/')[0];
      if (!seenDirs.has(topDir)) {
        seenDirs.add(topDir);
        items.push({
          path: topDir,
          name: topDir,
          savedAt: entry.savedAt,
          isDirectory: true,
        });
      }
      continue;
    }
    if (!directory && !entry.path.includes('/')) {
      // Entry is at root level
      items.push({
        path: entry.path,
        name: entry.path,
        savedAt: entry.savedAt,
        isDirectory: false,
      });
      continue;
    }

    // Entry path starts with prefix
    const relativePath = entry.path.slice(prefix.length);
    if (relativePath.includes('/')) {
      // Entry is in a subdirectory
      const subDir = relativePath.split('/')[0];
      const fullSubDirPath = prefix + subDir;
      if (!seenDirs.has(fullSubDirPath)) {
        seenDirs.add(fullSubDirPath);
        items.push({
          path: fullSubDirPath,
          name: subDir,
          savedAt: entry.savedAt,
          isDirectory: true,
        });
      }
    } else {
      // Entry is directly in this directory
      items.push({
        path: entry.path,
        name: relativePath,
        savedAt: entry.savedAt,
        isDirectory: false,
      });
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
}

// Export graph to file (download)
export function exportGraphToFile(data: GraphData, filename: string): void {
  const json = JSON.stringify({ path: filename, data }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Import graph from file
export function importGraphFromFile(file: File): Promise<{ path: string; data: GraphData }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);

        // Support both formats: { path, data } or just GraphData
        if (parsed.data && parsed.path) {
          resolve({ path: parsed.path, data: parsed.data });
        } else if (parsed.nodes && parsed.connections) {
          // Plain GraphData format, derive name from filename
          const name = file.name.replace(/\.json$/, '');
          resolve({ path: name, data: parsed as GraphData });
        } else {
          reject(new Error('Invalid graph file format'));
        }
      } catch (e) {
        reject(new Error('Failed to parse graph file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

const STORAGE_KEY = 'momimomi-graph';

export interface GraphData {
  nodes: unknown[];
  connections: unknown[];
}

export function saveGraph(data: GraphData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save graph to localStorage:', e);
  }
}

export function loadGraph(): GraphData | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
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
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear graph from localStorage:', e);
  }
}

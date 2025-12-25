import { useState, useCallback, useEffect } from 'react';
import { Timeline } from './components/Timeline';
import { GraphEditor } from './components/Graph/GraphEditor';
import type { TimelineItem } from './nostr/types';
import './App.css';

// Version: Update this on each deployment
export const APP_VERSION = '0.10.3';

const APP_NAME = '(.>_<)-(.>_<)-mojimoji: Nostr Modular Client';
const LOADING_PREFIX = '(.>_<)-(.>_<)-loading ';

interface TimelineData {
  id: string;
  name: string;
  items: TimelineItem[];
}

function App() {
  const [timelines, setTimelines] = useState<TimelineData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingDots, setLoadingDots] = useState('* * *');

  // Animate loading dots
  useEffect(() => {
    if (!isLoading) return;

    const frames = ['*    ', '* *  ', '* * *', '  * *', '    *', '  * *', '* * *', '* *  '];
    let frameIndex = 0;

    const interval = setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      setLoadingDots(frames[frameIndex]);
    }, 200);

    return () => clearInterval(interval);
  }, [isLoading]);

  const handleLoadingChange = useCallback((loading: boolean) => {
    setIsLoading(loading);
  }, []);

  const handleTimelineCreate = useCallback((id: string, name: string) => {
    setTimelines(prev => {
      const exists = prev.find(t => t.id === id);
      if (exists) {
        return prev.map(t => t.id === id ? { ...t, name } : t);
      }
      return [...prev, { id, name, items: [] }];
    });
  }, []);

  const handleTimelineRemove = useCallback((id: string) => {
    setTimelines(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleItemsUpdate = useCallback((id: string, items: TimelineItem[]) => {
    setTimelines(prev =>
      prev.map(t => t.id === id ? { ...t, items } : t)
    );
  }, []);

  return (
    <div className="app">
      <div className="title-bar">
        {isLoading ? LOADING_PREFIX + loadingDots : APP_NAME}
      </div>
      <div className="main-content">
        <div className="timeline-columns">
          {timelines.length === 0 ? (
            <div className="timeline-empty-state">
              <p>No timelines yet</p>
              <p className="hint">Connect a Timeline node in the graph editor</p>
            </div>
          ) : (
            timelines.map(timeline => (
              <Timeline
                key={timeline.id}
                name={timeline.name}
                items={timeline.items}
              />
            ))
          )}
        </div>
        <div className="graph-pane">
          <GraphEditor
            onTimelineCreate={handleTimelineCreate}
            onTimelineRemove={handleTimelineRemove}
            onItemsUpdate={handleItemsUpdate}
            onLoadingChange={handleLoadingChange}
          />
        </div>
      </div>
    </div>
  );
}

export default App;

import { useState, useCallback } from 'react';
import { Timeline } from './components/Timeline';
import { GraphEditor } from './components/Graph/GraphEditor';
import type { TimelineEvent } from './nostr/types';
import './App.css';

const APP_NAME = '(.>_<)-(.>_<)-mojimoji: Nostr Modular Client';

interface TimelineData {
  id: string;
  name: string;
  events: TimelineEvent[];
}

function App() {
  const [timelines, setTimelines] = useState<TimelineData[]>([]);

  const handleTimelineCreate = useCallback((id: string, name: string) => {
    setTimelines(prev => {
      const exists = prev.find(t => t.id === id);
      if (exists) {
        return prev.map(t => t.id === id ? { ...t, name } : t);
      }
      return [...prev, { id, name, events: [] }];
    });
  }, []);

  const handleTimelineRemove = useCallback((id: string) => {
    setTimelines(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleEventsUpdate = useCallback((id: string, events: TimelineEvent[]) => {
    setTimelines(prev =>
      prev.map(t => t.id === id ? { ...t, events } : t)
    );
  }, []);

  return (
    <div className="app">
      <div className="timeline-pane">
        <div className="title-bar">
          {APP_NAME}
        </div>
        <div className="timeline-content">
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
                events={timeline.events}
              />
            ))
          )}
        </div>
      </div>
      <div className="graph-pane">
        <GraphEditor
          onTimelineCreate={handleTimelineCreate}
          onTimelineRemove={handleTimelineRemove}
          onEventsUpdate={handleEventsUpdate}
        />
      </div>
    </div>
  );
}

export default App;

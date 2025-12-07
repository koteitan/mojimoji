import { ClassicPreset } from 'rete';

// Socket types for different data flows
export class EventSocket extends ClassicPreset.Socket {
  constructor() {
    super('Event');
  }
}

// Singleton sockets
export const eventSocket = new EventSocket();

// Filter item for Source node
export interface FilterItem {
  name: string;
  value: string;
}

// Node data interfaces
export interface SourceNodeControls {
  relayUrls: string[];
  filters: FilterItem[];
}

export interface OperatorNodeControls {
  operator: 'AND' | 'OR' | 'A-B';
}

export interface SearchNodeControls {
  keyword: string;
  useRegex: boolean;
}

export interface DisplayNodeControls {
  timelineName: string;
}

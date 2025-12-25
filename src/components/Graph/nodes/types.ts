import { ClassicPreset } from 'rete';

// Relay status enum
export type RelayStatusType = 'idle' | 'connecting' | 'sub-stored' | 'EOSE' | 'sub-realtime' | 'closed' | 'error';

// Socket types for different data flows
export class EventSocket extends ClassicPreset.Socket {
  constructor() {
    super('Event');
  }
}

export class EventIdSocket extends ClassicPreset.Socket {
  constructor() {
    super('EventId');
  }
}

export class PubkeySocket extends ClassicPreset.Socket {
  constructor() {
    super('Pubkey');
  }
}

export class RelaySocket extends ClassicPreset.Socket {
  constructor() {
    super('Relay');
  }
}

export class FlagSocket extends ClassicPreset.Socket {
  constructor() {
    super('Flag');
  }
}

export class IntegerSocket extends ClassicPreset.Socket {
  constructor() {
    super('Integer');
  }
}

export class DatetimeSocket extends ClassicPreset.Socket {
  constructor() {
    super('Datetime');
  }
}

export class RelayStatusSocket extends ClassicPreset.Socket {
  constructor() {
    super('RelayStatus');
  }
}

// Trigger socket for control flow
export class TriggerSocket extends ClassicPreset.Socket {
  constructor() {
    super('Trigger');
  }
}

// Any socket for universal input (accepts any type)
export class AnySocket extends ClassicPreset.Socket {
  constructor() {
    super('Any');
  }
}

// Singleton sockets
export const eventSocket = new EventSocket();
export const eventIdSocket = new EventIdSocket();
export const pubkeySocket = new PubkeySocket();
export const relaySocket = new RelaySocket();
export const flagSocket = new FlagSocket();
export const integerSocket = new IntegerSocket();
export const datetimeSocket = new DatetimeSocket();
export const relayStatusSocket = new RelayStatusSocket();
export const triggerSocket = new TriggerSocket();
export const anySocket = new AnySocket();

// Socket type name to socket instance mapping
export const socketMap: Record<string, ClassicPreset.Socket> = {
  'Event': eventSocket,
  'EventId': eventIdSocket,
  'Pubkey': pubkeySocket,
  'Relay': relaySocket,
  'Flag': flagSocket,
  'Integer': integerSocket,
  'Datetime': datetimeSocket,
  'RelayStatus': relayStatusSocket,
  'Trigger': triggerSocket,
  'Any': anySocket,
};

// Get socket by type name
export function getSocketByType(typeName: string): ClassicPreset.Socket | undefined {
  return socketMap[typeName];
}

// Filter item for Relay node
export interface FilterItem {
  name: string;
  value: string;
}

// Node data interfaces
export interface RelayNodeControls {
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

// TimelineNode no longer has controls - it detects type dynamically

import { ClassicPreset } from 'rete';

type Props = {
  data: ClassicPreset.Socket;
};

// Socket color mapping by type
const socketColors: Record<string, string> = {
  'Event': '#646cff',      // Blue-purple (original)
  'EventId': '#ff6b6b',    // Red
  'Pubkey': '#4ecdc4',     // Teal
  'Relay': '#ffe66d',      // Yellow
  'Flag': '#95e1d3',       // Mint green
  'Integer': '#f38181',    // Coral
  'Datetime': '#aa96da',   // Lavender
  'RelayStatus': '#fcbad3', // Pink
  'Trigger': '#a8d8ea',    // Light blue
};

// Custom socket component - rounded thin rectangle for vertical connections
export function CustomSocket({ data }: Props) {
  const color = socketColors[data.name] || '#646cff';

  return (
    <div
      className="custom-socket"
      title={data.name}
      style={{
        width: '40px',
        height: '12px',
        borderRadius: '6px',
        background: color,
        border: '2px solid #444',
        cursor: 'crosshair',
        pointerEvents: 'auto',
      }}
    />
  );
}

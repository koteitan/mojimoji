import { ClassicPreset } from 'rete';

type Props = {
  data: ClassicPreset.Socket;
};

// Custom socket component - rounded thin rectangle for vertical connections
export function CustomSocket({ data }: Props) {
  return (
    <div
      className="custom-socket"
      title={data.name}
      style={{
        width: '40px',
        height: '12px',
        borderRadius: '6px',
        background: '#646cff',
        border: '2px solid #444',
        cursor: 'crosshair',
        pointerEvents: 'auto',
      }}
    />
  );
}

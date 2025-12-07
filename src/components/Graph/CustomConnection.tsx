import type { ClassicScheme } from 'rete-react-plugin';
import { Presets } from 'rete-react-plugin';

// Custom connection component that renders the path from ConnectionPathPlugin
// The path is already calculated with vertical curves by the plugin
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function CustomConnection(props: { data: ClassicScheme['Connection']; path?: string; styles?: any }) {
  const { path, styles } = props;

  // Use the path from ConnectionPathPlugin if available
  // This path already has vertical curves applied
  if (!path) {
    // Fallback to default rendering if no path is provided
    return <Presets.classic.Connection {...props} />;
  }

  return (
    <svg
      data-testid="connection"
      style={{
        position: 'absolute',
        overflow: 'visible',
        pointerEvents: 'none',
        width: 0,
        height: 0,
        left: 0,
        top: 0,
      }}
    >
      <path
        d={path}
        fill="none"
        stroke={styles?.stroke || '#646cff'}
        strokeWidth={styles?.strokeWidth || 3}
        pointerEvents="visibleStroke"
      />
    </svg>
  );
}

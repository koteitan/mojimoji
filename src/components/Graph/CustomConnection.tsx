import styled from 'styled-components';
import { Presets } from 'rete-react-plugin';

// Get useConnection from the classic preset's ConnectionWrapper
const { useConnection } = Presets.classic;

// Styled SVG matching rete-react-plugin's Svg component
const Svg = styled.svg`
  overflow: visible !important;
  position: absolute;
  pointer-events: none;
  width: 9999px;
  height: 9999px;
`;

// Styled path matching rete-react-plugin's Path component
const StyledPath = styled.path`
  fill: none;
  stroke-width: 5px;
  stroke: #646cff;
  pointer-events: auto;
`;

// Create path with vertical ends and diagonal middle
// Pattern: output -> straight down -> curve -> diagonal -> curve -> straight down -> input
function createDiagonalPath(startX: number, startY: number, endX: number, endY: number): string {
  const cornerRadius = 80; // Radius for rounded corners
  const verticalOffset = 40; // Minimum vertical segment length at each end

  if (Math.abs(endX - startX) < 2) {
    // Straight vertical line
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }

  // Points where diagonal meets vertical segments
  const topOfDiagonalY = startY + verticalOffset;
  const bottomOfDiagonalY = endY - verticalOffset;

  // If not enough space (input above output), use S-curve with larger vertical offset
  if (bottomOfDiagonalY <= topOfDiagonalY) {
    // Fallback: S-curve with vertical ends
    const reverseVerticalOffset = 80; // Larger offset for reverse case
    const midX = (startX + endX) / 2;
    const cp1y = startY + reverseVerticalOffset;
    const cp2y = endY - reverseVerticalOffset;
    return `M ${startX} ${startY} C ${startX} ${cp1y} ${midX} ${cp1y} ${midX} ${(startY + endY) / 2} ` +
      `C ${midX} ${cp2y} ${endX} ${cp2y} ${endX} ${endY}`;
  }

  // Calculate corner adjustments
  const dx = endX - startX;
  const dy = bottomOfDiagonalY - topOfDiagonalY;
  const diagonalLength = Math.sqrt(dx * dx + dy * dy);
  const r = Math.min(cornerRadius, diagonalLength / 4);

  // Normalized diagonal direction
  const dirX = dx / diagonalLength;
  const dirY = dy / diagonalLength;

  // Corner points (where curves meet straight segments)
  // Top corner: transition from vertical to diagonal
  const topCornerY = topOfDiagonalY;
  const topCurveStartY = topCornerY - r;
  const topCurveEndX = startX + r * dirX;
  const topCurveEndY = topCornerY + r * dirY;

  // Bottom corner: transition from diagonal to vertical
  const bottomCornerY = bottomOfDiagonalY;
  const bottomCurveStartX = endX - r * dirX;
  const bottomCurveStartY = bottomCornerY - r * dirY;
  const bottomCurveEndY = bottomCornerY + r;

  return `M ${startX} ${startY} ` +
    `L ${startX} ${topCurveStartY} ` +
    `Q ${startX} ${topCornerY} ${topCurveEndX} ${topCurveEndY} ` +
    `L ${bottomCurveStartX} ${bottomCurveStartY} ` +
    `Q ${endX} ${bottomCornerY} ${endX} ${bottomCurveEndY} ` +
    `L ${endX} ${endY}`;
}

// Custom connection component with diagonal paths and rounded bezier corners
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function CustomConnection(_props: any) {
  const { start, end } = useConnection();

  // If we have start and end, create bezier path
  if (start && end) {
    // Apply horizontal correction (compensates for socket positioning)
    const horizontalCorrection = 12;
    const correctedStartX = start.x - horizontalCorrection;
    const correctedEndX = end.x + horizontalCorrection;

    const bezierPath = createDiagonalPath(correctedStartX, start.y, correctedEndX, end.y);

    return (
      <Svg data-testid="connection">
        <StyledPath d={bezierPath} />
      </Svg>
    );
  }

  // Fallback: return null while waiting for positions
  return null;
}

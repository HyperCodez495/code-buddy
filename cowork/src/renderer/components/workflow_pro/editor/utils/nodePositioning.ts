/**
 * Node positioning utilities
 * Provides collision avoidance for dropped/pasted/duplicated nodes.
 */

const DEFAULT_NODE_WIDTH = 250;
const DEFAULT_NODE_HEIGHT = 100;
const PADDING = 20;

/**
 * Check if two rectangles overlap (with padding).
 */
function rectsOverlap(
  a: { x: number; y: number },
  b: { x: number; y: number },
  w: number,
  h: number,
  pad: number
): boolean {
  return (
    a.x < b.x + w + pad &&
    a.x + w + pad > b.x &&
    a.y < b.y + h + pad &&
    a.y + h + pad > b.y
  );
}

/**
 * Find a non-overlapping position for a new node.
 * Tries the desired position first, then offsets in a spiral pattern.
 */
export function findNonOverlappingPosition(
  desired: { x: number; y: number },
  existingNodes: Array<{ position: { x: number; y: number } }>,
  nodeWidth = DEFAULT_NODE_WIDTH,
  nodeHeight = DEFAULT_NODE_HEIGHT,
  gridSize = 16
): { x: number; y: number } {
  if (existingNodes.length === 0) return desired;

  const hasOverlap = (pos: { x: number; y: number }) =>
    existingNodes.some((n) => rectsOverlap(pos, n.position, nodeWidth, nodeHeight, PADDING));

  if (!hasOverlap(desired)) return desired;

  // Spiral search: try positions radiating outward
  const step = gridSize > 0 ? gridSize * 4 : 64;
  for (let radius = 1; radius <= 10; radius++) {
    const offsets = [
      { x: step * radius, y: 0 },
      { x: 0, y: step * radius },
      { x: -step * radius, y: 0 },
      { x: 0, y: -step * radius },
      { x: step * radius, y: step * radius },
      { x: -step * radius, y: step * radius },
      { x: step * radius, y: -step * radius },
      { x: -step * radius, y: -step * radius },
    ];
    for (const offset of offsets) {
      const candidate = {
        x: desired.x + offset.x,
        y: desired.y + offset.y,
      };
      if (gridSize > 0) {
        candidate.x = Math.round(candidate.x / gridSize) * gridSize;
        candidate.y = Math.round(candidate.y / gridSize) * gridSize;
      }
      if (!hasOverlap(candidate)) return candidate;
    }
  }

  // Fallback: offset down-right
  return { x: desired.x + step, y: desired.y + step };
}

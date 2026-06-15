/**
 * Workflow Thumbnail Generator
 * Auto-generate workflow thumbnails for preview (like n8n)
 */

import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import { useWorkflowStore } from '../../../store/workflowStore';

interface WorkflowThumbnailGeneratorProps {
  workflowId?: string;
  width?: number;
  height?: number;
  padding?: number;
  showNodeLabels?: boolean;
  backgroundColor?: string;
  onGenerated?: (dataUrl: string) => void;
}

interface ThumbnailNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
  label: string;
  color: string;
}

interface ThumbnailEdge {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

// Node type colors
const NODE_COLORS: Record<string, string> = {
  'trigger': '#10B981',
  'webhook': '#10B981',
  'schedule': '#3B82F6',
  'http-request': '#6366F1',
  'code': '#8B5CF6',
  'if': '#F59E0B',
  'switch': '#EAB308',
  'merge': '#06B6D4',
  'set': '#EC4899',
  'function': '#8B5CF6',
  'default': '#6B7280',
};

const WorkflowThumbnailGenerator: React.FC<WorkflowThumbnailGeneratorProps> = ({
  _workflowId,
  width = 200,
  height = 150,
  padding = 10,
  showNodeLabels = false,
  backgroundColor = '#F9FAFB',
  onGenerated,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { nodes, edges } = useWorkflowStore();

  // Transform nodes and edges for thumbnail
  const { thumbnailNodes, thumbnailEdges, _bounds } = useMemo(() => {
    if (nodes.length === 0) {
      return { thumbnailNodes: [], thumbnailEdges: [], bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 } };
    }

    // Calculate bounds. @xyflow/react v12 exposes measured dimensions via
    // `node.measured.{width,height}` after the node has been rendered.
    // Fall back to n8n defaults for nodes that haven't been measured yet.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(node => {
      const x = node.position.x;
      const y = node.position.y;
      const w = node.measured?.width ?? node.width ?? 150;
      const h = node.measured?.height ?? node.height ?? 50;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + w);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + h);
    });

    const boundsWidth = maxX - minX || 100;
    const boundsHeight = maxY - minY || 100;

    // Calculate scale to fit in thumbnail
    const availableWidth = width - padding * 2;
    const availableHeight = height - padding * 2;
    const scaleX = availableWidth / boundsWidth;
    const scaleY = availableHeight / boundsHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Don't scale up

    // Transform nodes
    const tNodes: ThumbnailNode[] = nodes.map(node => {
      const x = (node.position.x - minX) * scale + padding;
      const y = (node.position.y - minY) * scale + padding;
      const w = (node.measured?.width ?? node.width ?? 150) * scale;
      const h = (node.measured?.height ?? node.height ?? 50) * scale;
      const nodeType = node.data?.type || 'default';

      return {
        id: node.id,
        x,
        y,
        width: Math.max(w, 8),
        height: Math.max(h, 6),
        type: nodeType,
        label: node.data?.label || nodeType,
        color: NODE_COLORS[nodeType] || NODE_COLORS.default,
      };
    });

    // Transform edges
    const nodeMap = new Map(tNodes.map(n => [n.id, n]));
    const tEdges: ThumbnailEdge[] = edges.map(edge => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return null;

      return {
        sourceX: source.x + source.width,
        sourceY: source.y + source.height / 2,
        targetX: target.x,
        targetY: target.y + target.height / 2,
      };
    }).filter(Boolean) as ThumbnailEdge[];

    return {
      thumbnailNodes: tNodes,
      thumbnailEdges: tEdges,
      bounds: { minX, maxX, minY, maxY },
    };
  }, [nodes, edges, width, height, padding]);

  // Draw thumbnail on canvas
  const drawThumbnail = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = width;
    canvas.height = height;

    // Draw background
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Draw grid pattern (subtle)
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 0.5;
    const gridSize = 10;
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Draw edges
    ctx.strokeStyle = '#9CA3AF';
    ctx.lineWidth = 1;
    thumbnailEdges.forEach(edge => {
      ctx.beginPath();
      ctx.moveTo(edge.sourceX, edge.sourceY);

      // Simple bezier curve
      const midX = (edge.sourceX + edge.targetX) / 2;
      ctx.bezierCurveTo(
        midX, edge.sourceY,
        midX, edge.targetY,
        edge.targetX, edge.targetY
      );
      ctx.stroke();
    });

    // Draw nodes
    thumbnailNodes.forEach(node => {
      // Node shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;

      // Node body
      ctx.fillStyle = node.color;
      ctx.beginPath();
      const radius = Math.min(4, node.height / 2);
      ctx.roundRect(node.x, node.y, node.width, node.height, radius);
      ctx.fill();

      // Reset shadow
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      // Node label (if enabled and space allows)
      if (showNodeLabels && node.width > 20) {
        ctx.fillStyle = 'white';
        ctx.font = `${Math.min(8, node.height - 4)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = node.label.length > 6 ? node.label.slice(0, 5) + '…' : node.label;
        ctx.fillText(label, node.x + node.width / 2, node.y + node.height / 2);
      }
    });

    // Generate data URL and callback
    if (onGenerated) {
      const dataUrl = canvas.toDataURL('image/png');
      onGenerated(dataUrl);
    }
  }, [thumbnailNodes, thumbnailEdges, width, height, backgroundColor, showNodeLabels, onGenerated]);

  // Draw on mount and when dependencies change
  useEffect(() => {
    drawThumbnail();
  }, [drawThumbnail]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="rounded-lg border border-gray-200"
      style={{ width, height }}
    />
  );
};

// Static thumbnail generator (for server-side or bulk generation)
// eslint-disable-next-line react-refresh/only-export-components
export const generateThumbnailDataUrl = (
  nodes: { position: { x: number; y: number }; width?: number; height?: number; data?: { type?: string; label?: string } }[],
  edges: { source: string; target: string }[],
  options?: {
    width?: number;
    height?: number;
    padding?: number;
    backgroundColor?: string;
  }
): string => {
  const { width = 200, height = 150, padding = 10, backgroundColor = '#F9FAFB' } = options || {};

  // Create off-screen canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Draw background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  if (nodes.length === 0) {
    return canvas.toDataURL('image/png');
  }

  // Calculate bounds and scale (same logic as component)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  nodes.forEach(node => {
    const x = node.position.x;
    const y = node.position.y;
    const w = node.width || 150;
    const h = node.height || 50;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + w);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + h);
  });

  const boundsWidth = maxX - minX || 100;
  const boundsHeight = maxY - minY || 100;
  const scaleX = (width - padding * 2) / boundsWidth;
  const scaleY = (height - padding * 2) / boundsHeight;
  const scale = Math.min(scaleX, scaleY, 1);

  // Draw nodes
  nodes.forEach(node => {
    const x = (node.position.x - minX) * scale + padding;
    const y = (node.position.y - minY) * scale + padding;
    const w = Math.max((node.width || 150) * scale, 8);
    const h = Math.max((node.height || 50) * scale, 6);
    const nodeType = node.data?.type || 'default';
    const color = NODE_COLORS[nodeType] || NODE_COLORS.default;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();
  });

  return canvas.toDataURL('image/png');
};

export default WorkflowThumbnailGenerator;

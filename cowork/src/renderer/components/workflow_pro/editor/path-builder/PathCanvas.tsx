/**
 * PathCanvas Component
 * The main canvas area for the path builder
 */

import React, { useRef } from 'react';
import { PathNodeComponent } from './PathNode';
import type {
  PathBuilderConfig,
  Position,
} from './types';

interface PathCanvasProps {
  config: PathBuilderConfig;
  selectedNode: string | null;
  selectedConnection: string | null;
  onNodeClick: (nodeId: string) => void;
  onNodeDragStart: (nodeId: string) => void;
  onNodeDragEnd: (nodeId: string, position: Position) => void;
  onConnectionClick: (connectionId: string) => void;
  readOnly?: boolean;
}

export const PathCanvas: React.FC<PathCanvasProps> = ({
  config,
  selectedNode,
  selectedConnection,
  onNodeClick,
  onNodeDragStart,
  onNodeDragEnd,
  onConnectionClick,
  readOnly = false,
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);

  const getConnectionCoordinates = (
    sourceId: string,
    targetId: string
  ): { x1: number; y1: number; x2: number; y2: number } | null => {
    const sourceNode = config.nodes.find(n => n.id === sourceId);
    const targetNode = config.nodes.find(n => n.id === targetId);

    if (!sourceNode || !targetNode) return null;

    // Assuming node dimensions of ~150x60
    const nodeWidth = 150;
    const nodeHeight = 60;

    return {
      x1: sourceNode.position.x + nodeWidth / 2,
      y1: sourceNode.position.y + nodeHeight,
      x2: targetNode.position.x + nodeWidth / 2,
      y2: targetNode.position.y,
    };
  };

  const getConnectionPath = (
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): string => {
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  };

  return (
    <div
      ref={canvasRef}
      className="path-builder-canvas"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '500px',
        backgroundColor: config.settings.showGrid ? '#f9fafb' : '#ffffff',
        backgroundImage: config.settings.showGrid
          ? `linear-gradient(#e5e7eb 1px, transparent 1px),
             linear-gradient(90deg, #e5e7eb 1px, transparent 1px)`
          : 'none',
        backgroundSize: config.settings.showGrid
          ? `${config.settings.gridSize}px ${config.settings.gridSize}px`
          : 'auto',
        overflow: 'hidden',
      }}
    >
      {/* Connections SVG Layer */}
      <svg
        className="connections-container"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon
              points="0 0, 10 3.5, 0 7"
              fill="#6b7280"
            />
          </marker>
        </defs>
        {config.connections.map(conn => {
          const coords = getConnectionCoordinates(conn.source, conn.target);
          if (!coords) return null;

          const isSelected = selectedConnection === conn.id;
          const strokeColor = conn.type === 'error'
            ? '#ef4444'
            : conn.type === 'conditional'
              ? '#f59e0b'
              : '#6b7280';

          return (
            <g key={conn.id}>
              {/* Clickable area (invisible, wider path) */}
              <path
                d={getConnectionPath(coords.x1, coords.y1, coords.x2, coords.y2)}
                fill="none"
                stroke="transparent"
                strokeWidth={20}
                style={{ pointerEvents: 'stroke', cursor: readOnly ? 'default' : 'pointer' }}
                onClick={() => !readOnly && onConnectionClick(conn.id)}
              />
              {/* Visible connection line */}
              <path
                d={getConnectionPath(coords.x1, coords.y1, coords.x2, coords.y2)}
                fill="none"
                stroke={isSelected ? '#3b82f6' : strokeColor}
                strokeWidth={isSelected ? 3 : 2}
                strokeDasharray={conn.animated ? '5,5' : undefined}
                markerEnd="url(#arrowhead)"
                style={{
                  transition: 'stroke 0.2s, stroke-width 0.2s',
                }}
              >
                {conn.animated && (
                  <animate
                    attributeName="stroke-dashoffset"
                    from="10"
                    to="0"
                    dur="0.5s"
                    repeatCount="indefinite"
                  />
                )}
              </path>
              {/* Connection label */}
              {conn.label && (
                <text
                  x={(coords.x1 + coords.x2) / 2}
                  y={(coords.y1 + coords.y2) / 2 - 10}
                  textAnchor="middle"
                  fontSize="12"
                  fill="#6b7280"
                  style={{ pointerEvents: 'none' }}
                >
                  {conn.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Nodes Container */}
      <div className="nodes-container">
        {config.nodes.map(node => (
          <PathNodeComponent
            key={node.id}
            node={node}
            isSelected={selectedNode === node.id}
            onClick={() => onNodeClick(node.id)}
            onDragStart={() => onNodeDragStart(node.id)}
            onDragEnd={(position) => onNodeDragEnd(node.id, position)}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
};

export default PathCanvas;

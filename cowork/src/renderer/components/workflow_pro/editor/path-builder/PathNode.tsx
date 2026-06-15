/**
 * PathNode Component
 * Individual path node rendering
 */

import React, { useState, useCallback, useRef } from 'react';
import type { PathNode, Position } from './types';

interface PathNodeComponentProps {
  node: PathNode;
  isSelected: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: (position: Position) => void;
  readOnly?: boolean;
}

const nodeTypeColors: Record<PathNode['type'], { bg: string; border: string; icon: string }> = {
  condition: { bg: '#fef3c7', border: '#f59e0b', icon: '?' },
  action: { bg: '#dbeafe', border: '#3b82f6', icon: '>' },
  merge: { bg: '#d1fae5', border: '#10b981', icon: 'M' },
  split: { bg: '#fce7f3', border: '#ec4899', icon: 'S' },
  loop: { bg: '#e0e7ff', border: '#6366f1', icon: 'L' },
  switch: { bg: '#fef9c3', border: '#eab308', icon: 'W' },
};

export const PathNodeComponent: React.FC<PathNodeComponentProps> = ({
  node,
  isSelected,
  onClick,
  onDragStart,
  onDragEnd,
  readOnly = false,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  const nodeRef = useRef<HTMLDivElement>(null);

  const colors = nodeTypeColors[node.type];

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (readOnly) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = nodeRef.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }

    setIsDragging(true);
    onDragStart();
  }, [readOnly, onDragStart]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || readOnly) return;

    const canvas = nodeRef.current?.parentElement;
    if (!canvas) return;

    const canvasRect = canvas.getBoundingClientRect();
    const newX = e.clientX - canvasRect.left - dragOffset.x;
    const newY = e.clientY - canvasRect.top - dragOffset.y;

    if (nodeRef.current) {
      nodeRef.current.style.left = `${Math.max(0, newX)}px`;
      nodeRef.current.style.top = `${Math.max(0, newY)}px`;
    }
  }, [isDragging, readOnly, dragOffset]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!isDragging) return;

    setIsDragging(false);

    const canvas = nodeRef.current?.parentElement;
    if (!canvas) return;

    const canvasRect = canvas.getBoundingClientRect();
    const newX = e.clientX - canvasRect.left - dragOffset.x;
    const newY = e.clientY - canvasRect.top - dragOffset.y;

    onDragEnd({
      x: Math.max(0, newX),
      y: Math.max(0, newY),
    });
  }, [isDragging, dragOffset, onDragEnd]);

  // Attach global mouse events when dragging
  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const hasErrors = !node.validation.isValid;
  const errorCount = node.validation.errors.length;

  return (
    <div
      ref={nodeRef}
      className={`path-node ${node.type} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{
        position: 'absolute',
        left: node.position.x,
        top: node.position.y,
        width: '150px',
        minHeight: '60px',
        backgroundColor: colors.bg,
        border: `2px solid ${isSelected ? '#3b82f6' : colors.border}`,
        borderRadius: '8px',
        padding: '8px 12px',
        cursor: readOnly ? 'default' : isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        boxShadow: isSelected
          ? '0 0 0 3px rgba(59, 130, 246, 0.3), 0 4px 6px -1px rgba(0, 0, 0, 0.1)'
          : '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
        transition: isDragging ? 'none' : 'box-shadow 0.2s, border-color 0.2s',
        zIndex: isDragging ? 100 : isSelected ? 10 : 1,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Node type indicator */}
      <div
        style={{
          position: 'absolute',
          top: '-10px',
          left: '10px',
          width: '20px',
          height: '20px',
          backgroundColor: colors.border,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 'bold',
          color: 'white',
        }}
      >
        {colors.icon}
      </div>

      {/* Node header */}
      <div
        className="node-header"
        style={{
          fontSize: '13px',
          fontWeight: 600,
          color: '#1f2937',
          marginBottom: '4px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          paddingTop: '4px',
        }}
      >
        {node.name}
      </div>

      {/* Node type label */}
      <div
        className="node-type"
        style={{
          fontSize: '11px',
          color: '#6b7280',
          textTransform: 'capitalize',
        }}
      >
        {node.type}
      </div>

      {/* Description if present */}
      {node.description && (
        <div
          style={{
            fontSize: '10px',
            color: '#9ca3af',
            marginTop: '4px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {node.description}
        </div>
      )}

      {/* Error indicator */}
      {hasErrors && (
        <div
          className="node-errors"
          style={{
            position: 'absolute',
            top: '-8px',
            right: '-8px',
            width: '20px',
            height: '20px',
            backgroundColor: '#ef4444',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            fontWeight: 'bold',
            color: 'white',
          }}
          title={`${errorCount} validation error${errorCount > 1 ? 's' : ''}`}
        >
          {errorCount}
        </div>
      )}

      {/* Connection handles */}
      <div
        className="handle-top"
        style={{
          position: 'absolute',
          top: '-5px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '10px',
          height: '10px',
          backgroundColor: '#9ca3af',
          borderRadius: '50%',
          border: '2px solid white',
        }}
      />
      <div
        className="handle-bottom"
        style={{
          position: 'absolute',
          bottom: '-5px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '10px',
          height: '10px',
          backgroundColor: '#9ca3af',
          borderRadius: '50%',
          border: '2px solid white',
        }}
      />
    </div>
  );
};

export default PathNodeComponent;

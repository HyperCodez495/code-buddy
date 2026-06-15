/**
 * PathToolbar Component
 * Toolbar for adding nodes and controlling the path builder
 */

import React from 'react';
import type { PathNodeType, Position } from './types';

interface PathToolbarProps {
  onAddNode: (type: PathNodeType, position: Position) => void;
  onValidate: () => void;
  onToggleTestMode: () => void;
  onRunTest: () => void;
  isTestMode: boolean;
  readOnly?: boolean;
}

interface NodeTypeButton {
  type: PathNodeType;
  label: string;
  icon: string;
  color: string;
}

const nodeTypes: NodeTypeButton[] = [
  { type: 'condition', label: 'Condition', icon: '?', color: '#f59e0b' },
  { type: 'action', label: 'Action', icon: '>', color: '#3b82f6' },
  { type: 'merge', label: 'Merge', icon: 'M', color: '#10b981' },
  { type: 'split', label: 'Split', icon: 'S', color: '#ec4899' },
  { type: 'loop', label: 'Loop', icon: 'L', color: '#6366f1' },
  { type: 'switch', label: 'Switch', icon: 'W', color: '#eab308' },
];

export const PathToolbar: React.FC<PathToolbarProps> = ({
  onAddNode,
  onValidate,
  onToggleTestMode,
  onRunTest,
  isTestMode,
  readOnly = false,
}) => {
  const handleAddNode = (type: PathNodeType) => {
    // Default position for new nodes
    onAddNode(type, { x: 100, y: 100 });
  };

  const buttonStyle: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '6px',
    border: '1px solid #e5e7eb',
    backgroundColor: 'white',
    cursor: readOnly ? 'not-allowed' : 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.2s',
    opacity: readOnly ? 0.6 : 1,
  };

  const nodeButtonStyle = (color: string): React.CSSProperties => ({
    ...buttonStyle,
    borderColor: color,
    color: color,
  });

  return (
    <div
      className="path-builder-toolbar"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        padding: '12px',
        backgroundColor: '#f9fafb',
        borderBottom: '1px solid #e5e7eb',
      }}
    >
      {/* Node type buttons */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderRight: '1px solid #e5e7eb',
          paddingRight: '12px',
        }}
      >
        {nodeTypes.map(({ type, label, icon, color }) => (
          <button
            key={type}
            onClick={() => !readOnly && handleAddNode(type)}
            disabled={readOnly}
            style={nodeButtonStyle(color)}
            title={`Add ${label} node`}
          >
            <span
              style={{
                width: '18px',
                height: '18px',
                backgroundColor: color,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '11px',
                fontWeight: 'bold',
              }}
            >
              {icon}
            </span>
            {label}
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={onValidate}
          style={{
            ...buttonStyle,
            borderColor: '#6b7280',
            color: '#6b7280',
          }}
          title="Validate path configuration"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M9 12l2 2 4-4" />
            <circle cx="12" cy="12" r="10" />
          </svg>
          Validate
        </button>

        <button
          onClick={onToggleTestMode}
          style={{
            ...buttonStyle,
            borderColor: isTestMode ? '#10b981' : '#6b7280',
            color: isTestMode ? '#10b981' : '#6b7280',
            backgroundColor: isTestMode ? '#d1fae5' : 'white',
          }}
          title={isTestMode ? 'Exit test mode' : 'Enter test mode'}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
          {isTestMode ? 'Exit Test' : 'Test Mode'}
        </button>

        {isTestMode && (
          <button
            onClick={onRunTest}
            style={{
              ...buttonStyle,
              borderColor: '#3b82f6',
              color: 'white',
              backgroundColor: '#3b82f6',
            }}
            title="Run test"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Run Test
          </button>
        )}
      </div>
    </div>
  );
};

export default PathToolbar;

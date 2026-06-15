/**
 * PathProperties Component
 * Property panel for editing selected nodes and connections
 */

import React from 'react';
import type { PathNode, PathConnection, PathBuilderConfig } from './types';

interface PathPropertiesProps {
  config: PathBuilderConfig;
  selectedNode: string | null;
  selectedConnection: string | null;
  onDeleteNode: (nodeId: string) => void;
  onDeleteConnection: (connectionId: string) => void;
  readOnly?: boolean;
}

export const PathProperties: React.FC<PathPropertiesProps> = ({
  config,
  selectedNode,
  selectedConnection,
  onDeleteNode,
  onDeleteConnection,
  readOnly = false,
}) => {
  const node = selectedNode
    ? config.nodes.find(n => n.id === selectedNode)
    : null;

  const connection = selectedConnection
    ? config.connections.find(c => c.id === selectedConnection)
    : null;

  if (!node && !connection) {
    return (
      <div
        className="path-properties-empty"
        style={{
          padding: '24px',
          textAlign: 'center',
          color: '#9ca3af',
        }}
      >
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          style={{ margin: '0 auto 12px' }}
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </svg>
        <p style={{ fontSize: '14px' }}>
          Select a node or connection to view its properties
        </p>
      </div>
    );
  }

  const panelStyle: React.CSSProperties = {
    padding: '16px',
    borderTop: '1px solid #e5e7eb',
    backgroundColor: 'white',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 500,
    color: '#6b7280',
    marginBottom: '4px',
    display: 'block',
  };

  const valueStyle: React.CSSProperties = {
    fontSize: '14px',
    color: '#1f2937',
    marginBottom: '12px',
  };

  const deleteButtonStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 16px',
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    cursor: readOnly ? 'not-allowed' : 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    marginTop: '16px',
    opacity: readOnly ? 0.6 : 1,
  };

  if (node) {
    return (
      <NodePropertiesPanel
        node={node}
        onDelete={() => onDeleteNode(node.id)}
        readOnly={readOnly}
        panelStyle={panelStyle}
        labelStyle={labelStyle}
        valueStyle={valueStyle}
        deleteButtonStyle={deleteButtonStyle}
      />
    );
  }

  if (connection) {
    return (
      <ConnectionPropertiesPanel
        connection={connection}
        config={config}
        onDelete={() => onDeleteConnection(connection.id)}
        readOnly={readOnly}
        panelStyle={panelStyle}
        labelStyle={labelStyle}
        valueStyle={valueStyle}
        deleteButtonStyle={deleteButtonStyle}
      />
    );
  }

  return null;
};

interface NodePropertiesPanelProps {
  node: PathNode;
  onDelete: () => void;
  readOnly: boolean;
  panelStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  valueStyle: React.CSSProperties;
  deleteButtonStyle: React.CSSProperties;
}

const NodePropertiesPanel: React.FC<NodePropertiesPanelProps> = ({
  node,
  onDelete,
  readOnly,
  panelStyle,
  labelStyle,
  valueStyle,
  deleteButtonStyle,
}) => {
  return (
    <div className="node-properties" style={panelStyle}>
      <h3
        style={{
          fontSize: '16px',
          fontWeight: 600,
          color: '#1f2937',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span
          style={{
            width: '24px',
            height: '24px',
            backgroundColor: '#3b82f6',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: '12px',
          }}
        >
          N
        </span>
        Edit Node
      </h3>

      <div>
        <span style={labelStyle}>Name</span>
        <div style={valueStyle}>{node.name}</div>
      </div>

      <div>
        <span style={labelStyle}>Type</span>
        <div
          style={{
            ...valueStyle,
            textTransform: 'capitalize',
          }}
        >
          {node.type}
        </div>
      </div>

      {node.description && (
        <div>
          <span style={labelStyle}>Description</span>
          <div style={valueStyle}>{node.description}</div>
        </div>
      )}

      <div>
        <span style={labelStyle}>Position</span>
        <div style={valueStyle}>
          X: {node.position.x.toFixed(0)}, Y: {node.position.y.toFixed(0)}
        </div>
      </div>

      <div>
        <span style={labelStyle}>Validation Status</span>
        <div
          style={{
            ...valueStyle,
            color: node.validation.isValid ? '#10b981' : '#ef4444',
          }}
        >
          {node.validation.isValid ? 'Valid' : `${node.validation.errors.length} error(s)`}
        </div>
      </div>

      {node.validation.errors.length > 0 && (
        <div
          style={{
            backgroundColor: '#fef2f2',
            padding: '8px 12px',
            borderRadius: '6px',
            marginBottom: '12px',
          }}
        >
          <span style={{ ...labelStyle, color: '#dc2626' }}>Errors</span>
          <ul style={{ margin: 0, padding: '0 0 0 16px', color: '#dc2626', fontSize: '12px' }}>
            {node.validation.errors.map((error, index) => (
              <li key={index}>{error.message}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={onDelete}
        disabled={readOnly}
        style={deleteButtonStyle}
      >
        Delete Node
      </button>
    </div>
  );
};

interface ConnectionPropertiesPanelProps {
  connection: PathConnection;
  config: PathBuilderConfig;
  onDelete: () => void;
  readOnly: boolean;
  panelStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  valueStyle: React.CSSProperties;
  deleteButtonStyle: React.CSSProperties;
}

const ConnectionPropertiesPanel: React.FC<ConnectionPropertiesPanelProps> = ({
  connection,
  config,
  onDelete,
  readOnly,
  panelStyle,
  labelStyle,
  valueStyle,
  deleteButtonStyle,
}) => {
  const sourceNode = config.nodes.find(n => n.id === connection.source);
  const targetNode = config.nodes.find(n => n.id === connection.target);

  return (
    <div className="connection-properties" style={panelStyle}>
      <h3
        style={{
          fontSize: '16px',
          fontWeight: 600,
          color: '#1f2937',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span
          style={{
            width: '24px',
            height: '24px',
            backgroundColor: '#6b7280',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: '12px',
          }}
        >
          C
        </span>
        Edit Connection
      </h3>

      <div>
        <span style={labelStyle}>Source</span>
        <div style={valueStyle}>{sourceNode?.name || 'Unknown'}</div>
      </div>

      <div>
        <span style={labelStyle}>Target</span>
        <div style={valueStyle}>{targetNode?.name || 'Unknown'}</div>
      </div>

      <div>
        <span style={labelStyle}>Type</span>
        <div
          style={{
            ...valueStyle,
            textTransform: 'capitalize',
          }}
        >
          {connection.type}
        </div>
      </div>

      {connection.label && (
        <div>
          <span style={labelStyle}>Label</span>
          <div style={valueStyle}>{connection.label}</div>
        </div>
      )}

      <div>
        <span style={labelStyle}>Animated</span>
        <div style={valueStyle}>{connection.animated ? 'Yes' : 'No'}</div>
      </div>

      <button
        onClick={onDelete}
        disabled={readOnly}
        style={deleteButtonStyle}
      >
        Delete Connection
      </button>
    </div>
  );
};

export default PathProperties;

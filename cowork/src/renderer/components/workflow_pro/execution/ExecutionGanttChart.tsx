/**
 * Execution Gantt Chart
 * Horizontal Gantt-style timeline showing per-node execution timing
 */

import React, { useMemo, useState } from 'react';
import { useWorkflowStore } from '../../../store/workflowStore';

interface NodeTimingData {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  startTime: number | null;
  endTime: number | null;
  duration: number | null;
  error?: string;
}

interface ExecutionGanttChartProps {
  /** Minimum width of the chart area in pixels */
  minWidth?: number;
  /** Height of each node row in pixels */
  rowHeight?: number;
  /** Called when a node bar is clicked */
  onNodeClick?: (nodeId: string) => void;
}

/**
 * ExecutionGanttChart - Displays workflow execution as a horizontal Gantt chart
 *
 * Features:
 * - Each node is a row with a horizontal bar
 * - Bar position = start time relative to workflow start
 * - Bar width = node execution duration
 * - Color coding by status: green=success, red=error, blue=running, gray=pending
 * - Hover tooltip shows node name and duration
 */
const ExecutionGanttChart: React.FC<ExecutionGanttChartProps> = ({
  minWidth = 400,
  rowHeight = 36,
  onNodeClick,
}) => {
  const {
    nodes,
    nodeExecutionStatus,
    executionResults,
    executionErrors,
    nodeExecutionData,
    isExecuting,
  } = useWorkflowStore();

  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  // Build timing data from execution state
  const nodeTimings: NodeTimingData[] = useMemo(() => {
    return nodes.map(node => {
      const status = (nodeExecutionStatus[node.id] || 'pending') as NodeTimingData['status'];
      const result = executionResults?.[node.id];
      const error = executionErrors?.[node.id];
      const execData = nodeExecutionData?.[node.id];

      // Extract timing information
      let startTime: number | null = null;
      let endTime: number | null = null;
      let duration: number | null = null;

      // Try to get timing from various sources
      if (execData) {
        if (execData.startedAt) {
          startTime = typeof execData.startedAt === 'number'
            ? execData.startedAt
            : new Date(execData.startedAt).getTime();
        }
        if (execData.finishedAt) {
          endTime = typeof execData.finishedAt === 'number'
            ? execData.finishedAt
            : new Date(execData.finishedAt).getTime();
        }
        if (execData.duration) {
          duration = execData.duration;
        }
      }

      // Fallback to result timestamp
      if (!startTime && result?.timestamp) {
        const ts = new Date(result.timestamp).getTime();
        if (!isNaN(ts)) {
          // If we have a result timestamp but no start, estimate
          endTime = ts;
          if (duration) {
            startTime = ts - duration;
          }
        }
      }

      // Calculate duration if we have both times
      if (startTime && endTime && !duration) {
        duration = endTime - startTime;
      }

      // For running nodes, use current time as end
      if (status === 'running' && startTime && !endTime) {
        endTime = Date.now();
        duration = endTime - startTime;
      }

      // Extract error message
      let errorMessage: string | undefined;
      if (error) {
        if (typeof error === 'string') {
          errorMessage = error;
        } else if (error && typeof error === 'object' && 'message' in error) {
          errorMessage = String((error as { message: unknown }).message);
        }
      }

      return {
        nodeId: node.id,
        nodeName: node.data?.label || node.data?.type || 'Unknown Node',
        nodeType: node.data?.type || 'unknown',
        status,
        startTime,
        endTime,
        duration,
        error: errorMessage,
      };
    });
  }, [nodes, nodeExecutionStatus, executionResults, executionErrors, nodeExecutionData]);

  // Calculate timeline bounds
  const timelineBounds = useMemo(() => {
    const validTimings = nodeTimings.filter(t => t.startTime !== null);
    if (validTimings.length === 0) {
      return { minTime: Date.now(), maxTime: Date.now() + 1000, totalDuration: 1000 };
    }

    const minTime = Math.min(...validTimings.map(t => t.startTime!));
    const maxTime = Math.max(...validTimings.map(t => t.endTime || t.startTime! + (t.duration || 100)));
    const totalDuration = Math.max(maxTime - minTime, 100); // At least 100ms to avoid division by zero

    return { minTime, maxTime, totalDuration };
  }, [nodeTimings]);

  // Get color for status
  const getStatusColor = (status: NodeTimingData['status']): string => {
    switch (status) {
      case 'success': return '#22c55e'; // green-500
      case 'error': return '#ef4444'; // red-500
      case 'running': return '#3b82f6'; // blue-500
      case 'skipped': return '#9ca3af'; // gray-400
      default: return '#d1d5db'; // gray-300
    }
  };

  // Get background color for status (lighter version)
  const _getStatusBgColor = (status: NodeTimingData['status']): string => {
    switch (status) {
      case 'success': return '#dcfce7'; // green-100
      case 'error': return '#fee2e2'; // red-100
      case 'running': return '#dbeafe'; // blue-100
      case 'skipped': return '#f3f4f6'; // gray-100
      default: return '#f9fafb'; // gray-50
    }
  };

  // Format duration for display
  const formatDuration = (ms: number | null): string => {
    if (ms === null) return '--';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  // Handle mouse move for tooltip positioning
  const handleMouseMove = (e: React.MouseEvent, nodeId: string) => {
    setHoveredNode(nodeId);
    setTooltipPosition({ x: e.clientX, y: e.clientY });
  };

  // Calculate bar position and width
  const calculateBarStyle = (timing: NodeTimingData, _chartWidth: number) => {
    if (timing.startTime === null) {
      // Node hasn't started - show placeholder bar
      return {
        left: 0,
        width: 4,
        opacity: 0.3,
      };
    }

    const { minTime, totalDuration } = timelineBounds;
    const relativeStart = timing.startTime - minTime;
    const duration = timing.duration || 100;

    const leftPercent = (relativeStart / totalDuration) * 100;
    const widthPercent = (duration / totalDuration) * 100;

    return {
      left: `${leftPercent}%`,
      width: `${Math.max(widthPercent, 1)}%`, // At least 1% width to be visible
      opacity: 1,
    };
  };

  // Chart container width
  const chartWidth = Math.max(minWidth, 600);
  const labelWidth = 180;
  const durationWidth = 80;
  const barAreaWidth = chartWidth - labelWidth - durationWidth;

  // Styles
  const containerStyle: React.CSSProperties = {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '13px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid #e5e7eb',
    backgroundColor: '#f9fafb',
    fontWeight: 600,
    color: '#374151',
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    height: rowHeight,
    borderBottom: '1px solid #f3f4f6',
  };

  const labelCellStyle: React.CSSProperties = {
    width: labelWidth,
    paddingLeft: 16,
    paddingRight: 8,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };

  const barCellStyle: React.CSSProperties = {
    flex: 1,
    position: 'relative',
    height: rowHeight - 8,
    marginTop: 4,
    marginBottom: 4,
    backgroundColor: '#f9fafb',
    borderRadius: 4,
  };

  const durationCellStyle: React.CSSProperties = {
    width: durationWidth,
    paddingLeft: 8,
    paddingRight: 16,
    textAlign: 'right',
    color: '#6b7280',
    fontSize: '12px',
    flexShrink: 0,
  };

  const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    left: tooltipPosition.x + 12,
    top: tooltipPosition.y + 12,
    backgroundColor: '#1f2937',
    color: '#ffffff',
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '12px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    zIndex: 9999,
    pointerEvents: 'none',
    maxWidth: 300,
  };

  const legendStyle: React.CSSProperties = {
    display: 'flex',
    gap: 16,
    padding: '12px 16px',
    borderTop: '1px solid #e5e7eb',
    backgroundColor: '#f9fafb',
    fontSize: '12px',
  };

  const legendItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  };

  const legendDotStyle = (color: string): React.CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: '50%',
    backgroundColor: color,
  });

  // Get hovered node data for tooltip
  const hoveredNodeData = hoveredNode
    ? nodeTimings.find(t => t.nodeId === hoveredNode)
    : null;

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ width: labelWidth }}>Node</div>
        <div style={{ flex: 1, textAlign: 'center' }}>Timeline</div>
        <div style={{ width: durationWidth, textAlign: 'right' }}>Duration</div>
      </div>

      {/* Rows */}
      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {nodeTimings.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>
            No nodes in workflow
          </div>
        ) : (
          nodeTimings.map((timing, index) => (
            <div
              key={timing.nodeId}
              style={{
                ...rowStyle,
                backgroundColor: index % 2 === 0 ? '#ffffff' : '#fafafa',
                cursor: onNodeClick ? 'pointer' : 'default',
              }}
              onClick={() => onNodeClick?.(timing.nodeId)}
              onMouseMove={(e) => handleMouseMove(e, timing.nodeId)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              {/* Node name */}
              <div style={labelCellStyle} title={timing.nodeName}>
                <span style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: getStatusColor(timing.status),
                  marginRight: 8,
                }} />
                {timing.nodeName}
              </div>

              {/* Bar area */}
              <div style={barCellStyle}>
                {timing.startTime !== null && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 4,
                      bottom: 4,
                      borderRadius: 4,
                      backgroundColor: getStatusColor(timing.status),
                      transition: timing.status === 'running' ? 'width 100ms' : 'none',
                      ...calculateBarStyle(timing, barAreaWidth),
                    }}
                  >
                    {/* Show animation for running nodes */}
                    {timing.status === 'running' && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          borderRadius: 4,
                          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                          animation: 'shimmer 1.5s infinite',
                        }}
                      />
                    )}
                  </div>
                )}
                {timing.startTime === null && timing.status !== 'pending' && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 4,
                      bottom: 4,
                      left: 0,
                      width: 4,
                      borderRadius: 4,
                      backgroundColor: getStatusColor(timing.status),
                      opacity: 0.4,
                    }}
                  />
                )}
              </div>

              {/* Duration */}
              <div style={durationCellStyle}>
                {formatDuration(timing.duration)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Legend */}
      <div style={legendStyle}>
        <div style={legendItemStyle}>
          <div style={legendDotStyle('#22c55e')} />
          <span>Success</span>
        </div>
        <div style={legendItemStyle}>
          <div style={legendDotStyle('#ef4444')} />
          <span>Error</span>
        </div>
        <div style={legendItemStyle}>
          <div style={legendDotStyle('#3b82f6')} />
          <span>Running</span>
        </div>
        <div style={legendItemStyle}>
          <div style={legendDotStyle('#d1d5db')} />
          <span>Pending</span>
        </div>
        <div style={legendItemStyle}>
          <div style={legendDotStyle('#9ca3af')} />
          <span>Skipped</span>
        </div>
        {isExecuting && (
          <div style={{ marginLeft: 'auto', color: '#3b82f6', fontWeight: 500 }}>
            Executing...
          </div>
        )}
      </div>

      {/* Tooltip */}
      {hoveredNode && hoveredNodeData && (
        <div style={tooltipStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{hoveredNodeData.nodeName}</div>
          <div style={{ color: '#9ca3af', marginBottom: 4 }}>{hoveredNodeData.nodeType}</div>
          <div>
            <span style={{ color: '#9ca3af' }}>Status: </span>
            <span style={{
              color: getStatusColor(hoveredNodeData.status),
              textTransform: 'capitalize',
            }}>
              {hoveredNodeData.status}
            </span>
          </div>
          <div>
            <span style={{ color: '#9ca3af' }}>Duration: </span>
            {formatDuration(hoveredNodeData.duration)}
          </div>
          {hoveredNodeData.error && (
            <div style={{ marginTop: 4, color: '#fca5a5' }}>
              Error: {hoveredNodeData.error}
            </div>
          )}
        </div>
      )}

      {/* CSS for shimmer animation */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

export default ExecutionGanttChart;

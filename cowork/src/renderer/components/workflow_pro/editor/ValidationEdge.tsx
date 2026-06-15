/**
 * Custom Edge with Validation Visual Feedback
 * Shows different styles for valid, invalid, and executing connections
 */

import React, { memo, useMemo } from 'react';
import {
  EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
} from '@xyflow/react';
import { useWorkflowStore } from '../../../store/workflowStore';
import { AlertCircle, CheckCircle, Loader2, Zap, Plus, Trash2 } from 'lucide-react';

export interface ValidationEdgeData {
  isValid?: boolean;
  validationError?: string;
  isExecuting?: boolean;
  executionStatus?: 'pending' | 'running' | 'success' | 'error';
  dataFlowCount?: number;
  label?: string;
  labelStyle?: 'default' | 'success' | 'error' | 'info';
}

const ValidationEdge: React.FC<EdgeProps<ValidationEdgeData>> = ({
  id,
  source,
  target,
  sourceHandle,
  targetHandle,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  selected,
}) => {
  const _nodeExecutionStatus = useWorkflowStore((state) => state.nodeExecutionStatus);
  const darkMode = useWorkflowStore((state) => state.darkMode);
  const deleteEdge = useWorkflowStore((state) => state.deleteEdge);

  // Calculate edge path
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  // Determine edge status and style
  const edgeStyle = useMemo(() => {
    const isValid = data?.isValid !== false;
    const isExecuting = data?.isExecuting;
    const executionStatus = data?.executionStatus;

    // Base colors
    const validColor = '#22c55e'; // Green
    const invalidColor = '#ef4444'; // Red
    const executingColor = '#3b82f6'; // Blue
    const defaultColor = darkMode ? '#64748b' : '#94a3b8';
    const selectedColor = '#8b5cf6'; // Purple

    let strokeColor = defaultColor;
    let strokeWidth = 2.5;
    let strokeDasharray = 'none';
    let animation = '';
    let glowColor = 'transparent';

    if (selected) {
      strokeColor = selectedColor;
      strokeWidth = 3.5;
      glowColor = selectedColor;
    } else if (executionStatus === 'running' || isExecuting) {
      strokeColor = executingColor;
      strokeWidth = 4;
      animation = 'flowPulse 1s ease-in-out infinite';
      glowColor = executingColor;
    } else if (executionStatus === 'success') {
      strokeColor = validColor;
      strokeWidth = 3;
      glowColor = validColor;
    } else if (executionStatus === 'error') {
      strokeColor = invalidColor;
      strokeWidth = 3;
      strokeDasharray = '8 4';
      glowColor = invalidColor;
    } else if (!isValid) {
      strokeColor = invalidColor;
      strokeWidth = 2.5;
      strokeDasharray = '5 5';
    }

    return {
      strokeColor,
      strokeWidth,
      strokeDasharray,
      animation,
      glowColor,
    };
  }, [data, selected, darkMode]);

  // Render status icon
  const StatusIcon = useMemo(() => {
    const executionStatus = data?.executionStatus;

    if (executionStatus === 'running') {
      return (
        <div className="absolute flex items-center justify-center bg-blue-500 rounded-full p-1 shadow-lg animate-pulse">
          <Loader2 size={12} className="text-white animate-spin" />
        </div>
      );
    }

    if (executionStatus === 'success') {
      return (
        <div className="absolute flex items-center justify-center bg-green-500 rounded-full p-1 shadow-lg">
          <CheckCircle size={12} className="text-white" />
        </div>
      );
    }

    if (executionStatus === 'error' || data?.isValid === false) {
      return (
        <div
          className="absolute flex items-center justify-center bg-red-500 rounded-full p-1 shadow-lg cursor-help"
          title={data?.validationError || 'Invalid connection'}
        >
          <AlertCircle size={12} className="text-white" />
        </div>
      );
    }

    if (data?.dataFlowCount && data.dataFlowCount > 0) {
      return (
        <div className="absolute flex items-center justify-center bg-purple-500 rounded-full px-1.5 py-0.5 shadow-lg">
          <Zap size={10} className="text-white mr-0.5" />
          <span className="text-[10px] text-white font-medium">{data.dataFlowCount}</span>
        </div>
      );
    }

    return null;
  }, [data]);

  return (
    <>
      {/* Glow effect for active edges */}
      {edgeStyle.glowColor !== 'transparent' && (
        <path
          d={edgePath}
          fill="none"
          stroke={edgeStyle.glowColor}
          strokeWidth={edgeStyle.strokeWidth + 6}
          strokeOpacity={0.2}
          strokeLinecap="round"
          style={{ filter: 'blur(4px)' }}
        />
      )}

      {/* Main edge path */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: edgeStyle.strokeColor,
          strokeWidth: edgeStyle.strokeWidth,
          strokeDasharray: edgeStyle.strokeDasharray,
          transition: 'all 0.3s ease',
        }}
      />

      {/* Animated flow particles for executing edges */}
      {(data?.executionStatus === 'running' || data?.isExecuting) && (
        <>
          <circle r={3} fill="#3b82f6">
            <animateMotion dur="1s" repeatCount="indefinite" path={edgePath} />
          </circle>
          <circle r={3} fill="#3b82f6" opacity={0.5}>
            <animateMotion dur="1s" repeatCount="indefinite" path={edgePath} begin="0.33s" />
          </circle>
          <circle r={3} fill="#3b82f6" opacity={0.25}>
            <animateMotion dur="1s" repeatCount="indefinite" path={edgePath} begin="0.66s" />
          </circle>
        </>
      )}

      {/* Edge label/status indicator */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="flex flex-col items-center gap-1"
        >
          {StatusIcon}

          {/* Edge action buttons (insert + delete) — n8n-style hover controls */}
          <div className="flex items-center gap-1">
            {/* Insert node on edge — n8n-style "+" hover button */}
            <button
              type="button"
              aria-label="Insert node on this connection"
              title="Insert node here"
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(
                  new CustomEvent('insert-on-edge', {
                    detail: {
                      edgeId: id,
                      source,
                      target,
                      sourceHandle: sourceHandle ?? null,
                      targetHandle: targetHandle ?? null,
                      position: { x: labelX, y: labelY },
                    },
                  })
                );
              }}
              className={`opacity-40 hover:opacity-100 nodrag nopan flex items-center justify-center w-5 h-5 rounded-full shadow-md border transition-opacity duration-150 ${
                darkMode
                  ? 'bg-gray-800 border-gray-600 text-gray-200 hover:bg-blue-600 hover:border-blue-600 hover:text-white'
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-blue-500 hover:border-blue-500 hover:text-white'
              }`}
              style={{ pointerEvents: 'all' }}
            >
              <Plus size={12} />
            </button>

            {/* Delete edge — n8n-style trash hover button */}
            <button
              type="button"
              aria-label="Delete edge"
              title="Delete connection"
              onClick={(e) => {
                e.stopPropagation();
                deleteEdge(id);
              }}
              className={`opacity-40 hover:opacity-100 nodrag nopan flex items-center justify-center w-5 h-5 rounded-full shadow-md border transition-opacity duration-150 ${
                darkMode
                  ? 'bg-gray-800 border-gray-600 text-gray-200 hover:bg-red-600 hover:border-red-600 hover:text-white'
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-red-500 hover:border-red-500 hover:text-white'
              }`}
              style={{ pointerEvents: 'all' }}
            >
              <Trash2 size={12} />
            </button>
          </div>

          {/* Custom label */}
          {data?.label && (
            <div
              className={`px-2 py-0.5 rounded text-xs font-medium shadow-sm whitespace-nowrap ${
                data.labelStyle === 'success'
                  ? 'bg-green-100 text-green-700 border border-green-200'
                  : data.labelStyle === 'error'
                    ? 'bg-red-100 text-red-700 border border-red-200'
                    : data.labelStyle === 'info'
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : darkMode
                        ? 'bg-gray-800 text-gray-200 border border-gray-700'
                        : 'bg-white text-gray-700 border border-gray-200'
              }`}
            >
              {data.label}
            </div>
          )}

          {/* Data count badge when selected */}
          {selected && data?.dataFlowCount !== undefined && data.dataFlowCount > 0 && !data?.label && (
            <div className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200 shadow-sm">
              {data.dataFlowCount} item{data.dataFlowCount > 1 ? 's' : ''}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>

      {/* CSS for animations */}
      <style>
        {`
          @keyframes flowPulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
          }
        `}
      </style>
    </>
  );
};

export default memo(ValidationEdge);

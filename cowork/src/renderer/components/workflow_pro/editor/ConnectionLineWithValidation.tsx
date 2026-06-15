/**
 * Custom Connection Line with Real-time Validation
 * Shows visual feedback while dragging a connection
 */

import React from 'react';
import { ConnectionLineComponentProps, getBezierPath } from '@xyflow/react';

interface ConnectionLineWithValidationProps extends ConnectionLineComponentProps {
  isValid?: boolean;
}

const ConnectionLineWithValidation: React.FC<ConnectionLineWithValidationProps> = ({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionLineStyle,
}) => {
  // Calculate the bezier path
  const [edgePath] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    targetX: toX,
    targetY: toY,
    sourcePosition: fromPosition,
    targetPosition: toPosition,
  });

  // Calculate distance for animation speed
  const distance = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
  const animationDuration = Math.max(0.5, Math.min(2, distance / 200));

  return (
    <g>
      {/* Glow effect background */}
      <path
        d={edgePath}
        fill="none"
        stroke="#3b82f6"
        strokeOpacity={0.3}
        strokeWidth={8}
        strokeLinecap="round"
        className="transition-all duration-150"
        style={{
          filter: 'blur(4px)',
        }}
      />

      {/* Main connection line with gradient */}
      <path
        d={edgePath}
        fill="none"
        stroke="url(#connectionGradient)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray="8 4"
        className="transition-all duration-150"
        style={{
          animation: `flowAnimation ${animationDuration}s linear infinite`,
          ...connectionLineStyle,
        }}
      />

      {/* Animated dots along the path */}
      <circle r={4} fill="#3b82f6" className="connection-dot">
        <animateMotion
          dur={`${animationDuration}s`}
          repeatCount="indefinite"
          path={edgePath}
        />
      </circle>
      <circle r={4} fill="#3b82f6" className="connection-dot" style={{ opacity: 0.5 }}>
        <animateMotion
          dur={`${animationDuration}s`}
          repeatCount="indefinite"
          path={edgePath}
          begin={`${animationDuration * 0.33}s`}
        />
      </circle>
      <circle r={4} fill="#3b82f6" className="connection-dot" style={{ opacity: 0.25 }}>
        <animateMotion
          dur={`${animationDuration}s`}
          repeatCount="indefinite"
          path={edgePath}
          begin={`${animationDuration * 0.66}s`}
        />
      </circle>

      {/* Target indicator circle */}
      <circle
        cx={toX}
        cy={toY}
        r={12}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={2}
        strokeDasharray="4 4"
        className="animate-pulse"
      >
        <animate
          attributeName="r"
          values="8;14;8"
          dur="1s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="1;0.5;1"
          dur="1s"
          repeatCount="indefinite"
        />
      </circle>

      {/* Gradient definition */}
      <defs>
        <linearGradient id="connectionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>

      <style>
        {`
          @keyframes flowAnimation {
            0% { stroke-dashoffset: 24; }
            100% { stroke-dashoffset: 0; }
          }
        `}
      </style>
    </g>
  );
};

export default ConnectionLineWithValidation;

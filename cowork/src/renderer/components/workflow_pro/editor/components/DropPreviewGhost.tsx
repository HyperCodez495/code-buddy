/**
 * DropPreviewGhost
 * Shows a translucent preview rectangle where a node will be placed during drag-over.
 */
import React from 'react';

interface DropPreviewGhostProps {
  position: { x: number; y: number };
  darkMode?: boolean;
}

const DropPreviewGhost: React.FC<DropPreviewGhostProps> = ({ position, darkMode }) => {
  return (
    <div
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        width: 250,
        height: 80,
        border: `2px dashed ${darkMode ? '#818cf8' : '#6366f1'}`,
        borderRadius: 12,
        backgroundColor: darkMode ? 'rgba(99, 102, 241, 0.08)' : 'rgba(99, 102, 241, 0.06)',
        pointerEvents: 'none',
        zIndex: 5,
        transition: 'left 0.05s, top 0.05s',
      }}
    />
  );
};

export default DropPreviewGhost;

/**
 * EditorStatusBar Component
 * n8n-style compact status bar with zoom presets and execution info
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Lock, ZoomIn, ZoomOut, Maximize2, ChevronUp, AlignHorizontalDistributeCenter } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';

export type ViewMode = 'normal' | 'compact' | 'detailed';

const ZOOM_PRESETS = [
  { label: '25%', value: 0.25 },
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2 },
];

export interface EditorStatusBarProps {
  nodeCount: number;
  edgeCount: number;
  currentEnvironment: string;
  isLocked: boolean;
  zoomLevel: number;
  viewMode: ViewMode;
  lastUpdate: string;
  darkMode: boolean;
}

export const EditorStatusBar: React.FC<EditorStatusBarProps> = ({
  nodeCount,
  edgeCount,
  currentEnvironment,
  isLocked,
  zoomLevel,
  lastUpdate,
  darkMode,
}) => {
  const [showZoomPresets, setShowZoomPresets] = useState(false);
  const presetsRef = useRef<HTMLDivElement>(null);
  const { zoomIn, zoomOut, fitView, zoomTo } = useReactFlow();

  const envColors: Record<string, string> = {
    dev: 'text-green-500',
    staging: 'text-yellow-500',
    prod: 'text-red-500',
  };

  const envLabel: Record<string, string> = {
    dev: 'Development',
    staging: 'Staging',
    prod: 'Production',
  };

  const handlePresetZoom = useCallback((value: number) => {
    zoomTo(value, { duration: 200 });
    setShowZoomPresets(false);
  }, [zoomTo]);

  // Close presets when clicking outside
  useEffect(() => {
    if (!showZoomPresets) return;
    const handleClick = (e: MouseEvent) => {
      if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) {
        setShowZoomPresets(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showZoomPresets]);

  return (
    <div
      className={`h-7 flex-shrink-0 ${
        darkMode
          ? 'bg-[#1e1e2e] text-gray-400 border-gray-700'
          : 'bg-white text-gray-500 border-gray-200'
      } border-t flex items-center px-3 text-[11px] select-none z-30`}
    >
      {/* Left: counts & environment */}
      <div className="flex items-center gap-2.5">
        <span className="flex items-center gap-1">
          <span className={`font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{nodeCount}</span>
          <span>node{nodeCount !== 1 ? 's' : ''}</span>
        </span>
        <span className="opacity-20">|</span>
        <span className="flex items-center gap-1">
          <span className={`font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{edgeCount}</span>
          <span>connection{edgeCount !== 1 ? 's' : ''}</span>
        </span>
        <span className="opacity-20">|</span>
        <span className={`font-medium ${envColors[currentEnvironment] || ''}`}>
          {envLabel[currentEnvironment] || currentEnvironment}
        </span>
        {isLocked && (
          <>
            <span className="opacity-20">|</span>
            <span className="flex items-center gap-1 text-amber-500">
              <Lock className="w-3 h-3" />
              Locked
            </span>
          </>
        )}
      </div>

      {/* Right: zoom controls & timestamp */}
      <div className="ml-auto flex items-center gap-1">
        <span className="opacity-40 mr-1">{lastUpdate}</span>

        <span className="opacity-20 mx-1">|</span>

        {/* Zoom controls */}
        <button
          onClick={() => zoomOut({ duration: 200 })}
          className={`p-1 rounded hover:${darkMode ? 'bg-gray-700' : 'bg-gray-100'} transition-colors`}
          title="Zoom out"
        >
          <ZoomOut className="w-3 h-3" />
        </button>

        {/* Zoom presets dropdown */}
        <div className="relative" ref={presetsRef}>
          <button
            onClick={() => setShowZoomPresets(!showZoomPresets)}
            className={`px-1.5 py-0.5 rounded font-mono font-medium min-w-[42px] text-center hover:${
              darkMode ? 'bg-gray-700' : 'bg-gray-100'
            } transition-colors flex items-center gap-0.5`}
            title="Zoom presets"
          >
            <span>{Math.round(zoomLevel * 100)}%</span>
            <ChevronUp className={`w-2.5 h-2.5 transition-transform ${showZoomPresets ? '' : 'rotate-180'}`} />
          </button>

          {showZoomPresets && (
            <div
              className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-1 rounded-lg shadow-lg border overflow-hidden ${
                darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
              }`}
            >
              {ZOOM_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => handlePresetZoom(preset.value)}
                  className={`w-full px-4 py-1 text-[11px] text-left transition-colors ${
                    Math.abs(zoomLevel - preset.value) < 0.05
                      ? 'bg-[var(--n8n-color-primary,#ff6d5a)] text-white font-medium'
                      : darkMode
                        ? 'hover:bg-gray-700 text-gray-300'
                        : 'hover:bg-gray-50 text-gray-600'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => zoomIn({ duration: 200 })}
          className={`p-1 rounded hover:${darkMode ? 'bg-gray-700' : 'bg-gray-100'} transition-colors`}
          title="Zoom in"
        >
          <ZoomIn className="w-3 h-3" />
        </button>

        <button
          onClick={() => fitView({ padding: 0.2, duration: 300 })}
          className={`p-1 rounded hover:${darkMode ? 'bg-gray-700' : 'bg-gray-100'} transition-colors`}
          title="Fit view"
        >
          <Maximize2 className="w-3 h-3" />
        </button>

        <button
          onClick={() => window.dispatchEvent(new CustomEvent('auto-layout'))}
          className={`p-1 rounded hover:${darkMode ? 'bg-gray-700' : 'bg-gray-100'} transition-colors`}
          title="Tidy up / Auto-arrange"
        >
          <AlignHorizontalDistributeCenter className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

export default EditorStatusBar;

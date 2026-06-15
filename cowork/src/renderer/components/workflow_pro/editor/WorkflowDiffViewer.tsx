/**
 * Workflow Diff Viewer
 * Visual comparison between workflow versions (like n8n)
 */

import React, { useState, useMemo } from 'react';
import {
  GitCompare,
  X,
  Plus,
  Minus,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Clock,
  User,
  CheckCircle,
} from 'lucide-react';

interface WorkflowDiffViewerProps {
  isOpen: boolean;
  onClose: () => void;
  baseVersion: WorkflowVersion;
  compareVersion: WorkflowVersion;
  onRevert?: (versionId: string) => void;
}

interface WorkflowVersion {
  id: string;
  name: string;
  version: string;
  createdAt: Date;
  createdBy: string;
  nodes: DiffNode[];
  edges: DiffEdge[];
  settings: Record<string, unknown>;
}

interface DiffNode {
  id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

interface DiffEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
}

interface DiffResult {
  added: string[];
  removed: string[];
  modified: { id: string; changes: ChangeDetail[] }[];
  unchanged: string[];
}

interface ChangeDetail {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

type ViewMode = 'split' | 'unified' | 'visual';

// ── Visual diff: side-by-side mini-canvas comparison ──────────────────────────
const DIFF_STATUS_COLOR: Record<string, string> = {
  added: '#16a34a',
  removed: '#dc2626',
  modified: '#d97706',
  unchanged: '#9ca3af',
};

function diffStatusOf(id: string, diff: DiffResult): 'added' | 'removed' | 'modified' | 'unchanged' {
  if (diff.added.includes(id)) return 'added';
  if (diff.removed.includes(id)) return 'removed';
  if (diff.modified.some(m => m.id === id)) return 'modified';
  return 'unchanged';
}

function VisualDiffCanvas({ version, diff, title }: { version: WorkflowVersion; diff: DiffResult; title: string }) {
  const W = 360, H = 320, PAD = 24, NODE_W = 88, NODE_H = 28;
  const nodes = version.nodes;
  if (nodes.length === 0) {
    return (
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-500 mb-1">{title}</div>
        <div className="h-[320px] flex items-center justify-center bg-gray-50 rounded text-gray-400 text-sm">No nodes</div>
      </div>
    );
  }
  const xs = nodes.map(n => n.position?.x ?? 0);
  const ys = nodes.map(n => n.position?.y ?? 0);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  const sx = (x: number) => PAD + ((x - minX) / spanX) * (W - 2 * PAD - NODE_W);
  const sy = (y: number) => PAD + ((y - minY) / spanY) * (H - 2 * PAD - NODE_H);
  const pos: Record<string, { x: number; y: number }> = {};
  nodes.forEach(n => { pos[n.id] = { x: sx(n.position?.x ?? 0), y: sy(n.position?.y ?? 0) }; });

  return (
    <div className="flex-1 min-w-0">
      <div className="text-xs font-medium text-gray-500 mb-1">{title}</div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="bg-gray-50 rounded border border-gray-200">
        {version.edges.map(e => {
          const s = pos[e.source], t = pos[e.target];
          if (!s || !t) return null;
          return <line key={e.id} x1={s.x + NODE_W / 2} y1={s.y + NODE_H / 2} x2={t.x + NODE_W / 2} y2={t.y + NODE_H / 2} stroke="#cbd5e1" strokeWidth={1.5} />;
        })}
        {nodes.map(n => {
          const p = pos[n.id];
          const color = DIFF_STATUS_COLOR[diffStatusOf(n.id, diff)];
          return (
            <g key={n.id}>
              <rect x={p.x} y={p.y} width={NODE_W} height={NODE_H} rx={6} fill={`${color}22`} stroke={color} strokeWidth={1.5} />
              <text x={p.x + NODE_W / 2} y={p.y + NODE_H / 2 + 3} textAnchor="middle" fontSize={9} fill="#374151">
                {(n.label || n.type || n.id).slice(0, 13)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function DiffLegend() {
  const items: [string, string][] = [['added', 'Added'], ['removed', 'Removed'], ['modified', 'Modified'], ['unchanged', 'Unchanged']];
  return (
    <div className="flex items-center gap-4 justify-center mt-3 text-xs text-gray-500">
      {items.map(([k, label]) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: `${DIFF_STATUS_COLOR[k]}22`, border: `1.5px solid ${DIFF_STATUS_COLOR[k]}` }} />
          {label}
        </span>
      ))}
    </div>
  );
}

const WorkflowDiffViewer: React.FC<WorkflowDiffViewerProps> = ({
  isOpen,
  onClose,
  baseVersion,
  compareVersion,
  onRevert,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [showOnlyChanges, setShowOnlyChanges] = useState(true);

  // Calculate diff
  const diff = useMemo((): DiffResult => {
    const baseNodeIds = new Set(baseVersion.nodes.map(n => n.id));
    const compareNodeIds = new Set(compareVersion.nodes.map(n => n.id));

    const added = compareVersion.nodes
      .filter(n => !baseNodeIds.has(n.id))
      .map(n => n.id);

    const removed = baseVersion.nodes
      .filter(n => !compareNodeIds.has(n.id))
      .map(n => n.id);

    const modified: { id: string; changes: ChangeDetail[] }[] = [];
    const unchanged: string[] = [];

    baseVersion.nodes.forEach(baseNode => {
      if (!compareNodeIds.has(baseNode.id)) return;

      const compareNode = compareVersion.nodes.find(n => n.id === baseNode.id);
      if (!compareNode) return;

      const changes: ChangeDetail[] = [];

      // Check for changes
      if (baseNode.label !== compareNode.label) {
        changes.push({ field: 'label', oldValue: baseNode.label, newValue: compareNode.label });
      }
      if (baseNode.type !== compareNode.type) {
        changes.push({ field: 'type', oldValue: baseNode.type, newValue: compareNode.type });
      }
      if (baseNode.position.x !== compareNode.position.x || baseNode.position.y !== compareNode.position.y) {
        changes.push({
          field: 'position',
          oldValue: `${baseNode.position.x}, ${baseNode.position.y}`,
          newValue: `${compareNode.position.x}, ${compareNode.position.y}`,
        });
      }

      // Check config changes
      const configChanges = compareConfigs(baseNode.config, compareNode.config);
      changes.push(...configChanges);

      if (changes.length > 0) {
        modified.push({ id: baseNode.id, changes });
      } else {
        unchanged.push(baseNode.id);
      }
    });

    return { added, removed, modified, unchanged };
  }, [baseVersion, compareVersion]);

  // Compare configs helper
  const compareConfigs = (base: Record<string, unknown>, compare: Record<string, unknown>): ChangeDetail[] => {
    const changes: ChangeDetail[] = [];
    const allKeys = new Set([...Object.keys(base), ...Object.keys(compare)]);

    allKeys.forEach(key => {
      const baseVal = base[key];
      const compareVal = compare[key];

      if (JSON.stringify(baseVal) !== JSON.stringify(compareVal)) {
        changes.push({ field: `config.${key}`, oldValue: baseVal, newValue: compareVal });
      }
    });

    return changes;
  };

  // Toggle node expansion
  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  // Get node by ID from version
  const getNode = (version: WorkflowVersion, nodeId: string) => {
    return version.nodes.find(n => n.id === nodeId);
  };

  // Format value for display
  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  // Stats
  const stats = {
    total: baseVersion.nodes.length + diff.added.length,
    added: diff.added.length,
    removed: diff.removed.length,
    modified: diff.modified.length,
    unchanged: diff.unchanged.length,
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-5xl mx-4 bg-white rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-violet-50 to-purple-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-100 rounded-lg">
              <GitCompare size={20} className="text-violet-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Workflow Diff</h2>
              <p className="text-sm text-gray-500">
                Comparing {baseVersion.version} → {compareVersion.version}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 bg-gray-50">
          {/* View mode */}
          <div className="flex items-center gap-2 bg-gray-200 rounded-lg p-0.5">
            {(['split', 'unified', 'visual'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === mode
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-sm">
              <Plus size={14} className="text-green-500" />
              <span className="text-green-600 font-medium">{stats.added}</span>
            </span>
            <span className="flex items-center gap-1.5 text-sm">
              <Minus size={14} className="text-red-500" />
              <span className="text-red-600 font-medium">{stats.removed}</span>
            </span>
            <span className="flex items-center gap-1.5 text-sm">
              <RefreshCw size={14} className="text-amber-500" />
              <span className="text-amber-600 font-medium">{stats.modified}</span>
            </span>
          </div>

          {/* Filter */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showOnlyChanges}
              onChange={(e) => setShowOnlyChanges(e.target.checked)}
              className="w-4 h-4 text-violet-600 rounded focus:ring-violet-500"
            />
            <span className="text-gray-600">Show only changes</span>
          </label>
        </div>

        {/* Version info */}
        <div className="flex border-b border-gray-200">
          <div className="flex-1 px-4 py-2 bg-red-50/50 border-r border-gray-200">
            <div className="flex items-center gap-2 text-sm">
              <Clock size={14} className="text-gray-400" />
              <span className="font-medium text-gray-900">{baseVersion.version}</span>
              <span className="text-gray-500">({baseVersion.createdAt.toLocaleDateString()})</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
              <User size={12} />
              {baseVersion.createdBy}
            </div>
          </div>
          <div className="flex-1 px-4 py-2 bg-green-50/50">
            <div className="flex items-center gap-2 text-sm">
              <Clock size={14} className="text-gray-400" />
              <span className="font-medium text-gray-900">{compareVersion.version}</span>
              <span className="text-gray-500">({compareVersion.createdAt.toLocaleDateString()})</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
              <User size={12} />
              {compareVersion.createdBy}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {viewMode === 'split' && (
            <div className="divide-y divide-gray-100">
              {/* Added nodes */}
              {diff.added.map(nodeId => {
                const node = getNode(compareVersion, nodeId);
                if (!node) return null;

                return (
                  <div key={nodeId} className="flex">
                    <div className="flex-1 p-4 bg-gray-50/50 border-r border-gray-100" />
                    <div className="flex-1 p-4 bg-green-50/50">
                      <div className="flex items-center gap-2">
                        <Plus size={16} className="text-green-500" />
                        <span className="font-medium text-green-700">{node.label}</span>
                        <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                          {node.type}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Removed nodes */}
              {diff.removed.map(nodeId => {
                const node = getNode(baseVersion, nodeId);
                if (!node) return null;

                return (
                  <div key={nodeId} className="flex">
                    <div className="flex-1 p-4 bg-red-50/50 border-r border-gray-100">
                      <div className="flex items-center gap-2">
                        <Minus size={16} className="text-red-500" />
                        <span className="font-medium text-red-700 line-through">{node.label}</span>
                        <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                          {node.type}
                        </span>
                      </div>
                    </div>
                    <div className="flex-1 p-4 bg-gray-50/50" />
                  </div>
                );
              })}

              {/* Modified nodes */}
              {diff.modified.map(({ id, changes }) => {
                const baseNode = getNode(baseVersion, id);
                const compareNode = getNode(compareVersion, id);
                if (!baseNode || !compareNode) return null;

                const isExpanded = expandedNodes.has(id);

                return (
                  <div key={id}>
                    <button
                      onClick={() => toggleNode(id)}
                      className="w-full flex items-center p-4 hover:bg-amber-50/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 flex-1">
                        {isExpanded ? (
                          <ChevronDown size={16} className="text-amber-500" />
                        ) : (
                          <ChevronRight size={16} className="text-amber-500" />
                        )}
                        <RefreshCw size={16} className="text-amber-500" />
                        <span className="font-medium text-amber-700">{baseNode.label}</span>
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                          {changes.length} change{changes.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-100">
                        {changes.map((change, i) => (
                          <div key={i} className="flex text-sm">
                            <div className="flex-1 p-3 bg-red-50/30 border-r border-gray-100 font-mono text-xs">
                              <span className="text-gray-500">{change.field}: </span>
                              <span className="text-red-600">{formatValue(change.oldValue)}</span>
                            </div>
                            <div className="flex-1 p-3 bg-green-50/30 font-mono text-xs">
                              <span className="text-gray-500">{change.field}: </span>
                              <span className="text-green-600">{formatValue(change.newValue)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Unchanged nodes */}
              {!showOnlyChanges && diff.unchanged.map(nodeId => {
                const node = getNode(baseVersion, nodeId);
                if (!node) return null;

                return (
                  <div key={nodeId} className="flex">
                    <div className="flex-1 p-4 border-r border-gray-100">
                      <div className="flex items-center gap-2 text-gray-500">
                        <CheckCircle size={16} className="text-gray-400" />
                        <span>{node.label}</span>
                        <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                          {node.type}
                        </span>
                      </div>
                    </div>
                    <div className="flex-1 p-4">
                      <div className="flex items-center gap-2 text-gray-500">
                        <CheckCircle size={16} className="text-gray-400" />
                        <span>{node.label}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {viewMode === 'unified' && (
            <div className="p-4 font-mono text-sm">
              {diff.added.map(nodeId => {
                const node = getNode(compareVersion, nodeId);
                return node && (
                  <div key={nodeId} className="bg-green-50 text-green-700 px-2 py-1">
                    + {node.label} ({node.type})
                  </div>
                );
              })}
              {diff.removed.map(nodeId => {
                const node = getNode(baseVersion, nodeId);
                return node && (
                  <div key={nodeId} className="bg-red-50 text-red-700 px-2 py-1">
                    - {node.label} ({node.type})
                  </div>
                );
              })}
              {diff.modified.map(({ id, changes }) => {
                const node = getNode(compareVersion, id);
                return node && (
                  <div key={id} className="bg-amber-50 text-amber-700 px-2 py-1">
                    ~ {node.label}: {changes.length} changes
                  </div>
                );
              })}
            </div>
          )}

          {viewMode === 'visual' && (
            <div className="p-4">
              <div className="flex gap-4">
                <VisualDiffCanvas version={baseVersion} diff={diff} title={`Base · ${baseVersion.version}`} />
                <VisualDiffCanvas version={compareVersion} diff={diff} title={`Compare · ${compareVersion.version}`} />
              </div>
              <DiffLegend />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="text-sm text-gray-500">
            {stats.total} nodes total • {stats.added + stats.removed + stats.modified} changes
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Close
            </button>
            {onRevert && (
              <button
                onClick={() => onRevert(baseVersion.id)}
                className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors flex items-center gap-2 text-sm"
              >
                <RefreshCw size={16} />
                Revert to {baseVersion.version}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowDiffViewer;

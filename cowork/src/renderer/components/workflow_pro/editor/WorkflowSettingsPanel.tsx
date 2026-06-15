/**
 * Workflow Settings Panel
 * Global workflow configuration (like n8n)
 */

import React, { useState, useCallback } from 'react';
import {
  Settings,
  X,
  RefreshCw,
  AlertTriangle,
  Save,
  Zap,
  Timer,
  Database,
  GitBranch,
} from 'lucide-react';

interface WorkflowSettings {
  name: string;
  description: string;
  timeout: number; // in seconds
  retryOnFail: boolean;
  retryCount: number;
  retryDelay: number; // in seconds
  saveExecutions: boolean;
  executionRetention: number; // in days
  errorWorkflowId: string | null;
  timezone: string;
  notes: string;
}

interface WorkflowSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Partial<WorkflowSettings>;
  onSave: (settings: Partial<WorkflowSettings>) => void;
}

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
];

const WorkflowSettingsPanel: React.FC<WorkflowSettingsPanelProps> = ({
  isOpen,
  onClose,
  settings: initialSettings,
  onSave,
}) => {
  const [settings, setSettings] = useState<Partial<WorkflowSettings>>({
    name: '',
    description: '',
    timeout: 300,
    retryOnFail: false,
    retryCount: 3,
    retryDelay: 5,
    saveExecutions: true,
    executionRetention: 30,
    errorWorkflowId: null,
    timezone: 'UTC',
    notes: '',
    ...initialSettings,
  });
  const [hasChanges, setHasChanges] = useState(false);

  const updateSetting = useCallback(<K extends keyof WorkflowSettings>(
    key: K,
    value: WorkflowSettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(() => {
    onSave(settings);
    setHasChanges(false);
    onClose();
  }, [settings, onSave, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-2xl mx-4 bg-white rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-3">
            <Settings size={24} className="text-gray-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Workflow Settings</h2>
              <p className="text-sm text-gray-500">Configure global workflow behavior</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Basic Info */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Database size={16} className="text-blue-500" />
              Basic Information
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Workflow Name
                </label>
                <input
                  type="text"
                  value={settings.name || ''}
                  onChange={(e) => updateSetting('name', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="My Workflow"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={settings.description || ''}
                  onChange={(e) => updateSetting('description', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Describe what this workflow does..."
                />
              </div>
            </div>
          </section>

          {/* Execution Settings */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Zap size={16} className="text-amber-500" />
              Execution Settings
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Timeout (seconds)
                  </label>
                  <input
                    type="number"
                    value={settings.timeout || 300}
                    onChange={(e) => updateSetting('timeout', parseInt(e.target.value))}
                    min={0}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Timezone
                  </label>
                  <select
                    value={settings.timezone || 'UTC'}
                    onChange={(e) => updateSetting('timezone', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {TIMEZONES.map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </section>

          {/* Retry Settings */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <RefreshCw size={16} className="text-green-500" />
              Retry on Failure
            </h3>
            <div className="space-y-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={settings.retryOnFail || false}
                  onChange={(e) => updateSetting('retryOnFail', e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Automatically retry failed executions</span>
              </label>

              {settings.retryOnFail && (
                <div className="grid grid-cols-2 gap-4 pl-7">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Retry Count
                    </label>
                    <input
                      type="number"
                      value={settings.retryCount || 3}
                      onChange={(e) => updateSetting('retryCount', parseInt(e.target.value))}
                      min={1}
                      max={10}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Delay (seconds)
                    </label>
                    <input
                      type="number"
                      value={settings.retryDelay || 5}
                      onChange={(e) => updateSetting('retryDelay', parseInt(e.target.value))}
                      min={0}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Error Handling */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-500" />
              Error Handling
            </h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Error Workflow
              </label>
              <select
                value={settings.errorWorkflowId || ''}
                onChange={(e) => updateSetting('errorWorkflowId', e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">No error workflow</option>
                <option value="error-handler-1">Error Handler Workflow</option>
                <option value="notification-workflow">Notification Workflow</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">
                This workflow will be triggered when execution fails
              </p>
            </div>
          </section>

          {/* Data Retention */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Timer size={16} className="text-purple-500" />
              Data Retention
            </h3>
            <div className="space-y-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={settings.saveExecutions !== false}
                  onChange={(e) => updateSetting('saveExecutions', e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Save execution data</span>
              </label>

              {settings.saveExecutions !== false && (
                <div className="pl-7">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Retention Period (days)
                  </label>
                  <input
                    type="number"
                    value={settings.executionRetention || 30}
                    onChange={(e) => updateSetting('executionRetention', parseInt(e.target.value))}
                    min={1}
                    max={365}
                    className="w-32 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>
          </section>

          {/* Notes */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <GitBranch size={16} className="text-cyan-500" />
              Notes
            </h3>
            <textarea
              value={settings.notes || ''}
              onChange={(e) => updateSetting('notes', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Add any notes about this workflow..."
            />
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className={`px-4 py-2 text-sm rounded-lg transition-colors flex items-center gap-2 ${
              hasChanges
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Save size={16} />
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkflowSettingsPanel;

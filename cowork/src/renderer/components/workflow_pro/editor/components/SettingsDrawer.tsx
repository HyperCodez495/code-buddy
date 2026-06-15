/**
 * SettingsDrawer
 *
 * Right-side drawer that hosts the editor's workflow-level configuration
 * panels — General settings (timeout, priority, retention, error workflow,
 * description) and Error Notifications (email / Slack / webhook / in-app).
 *
 * Both child panels (`panels/WorkflowSettingsPanel` and
 * `panels/ErrorNotificationConfig`) were already implemented but had zero
 * imports anywhere in the editor. This drawer is the wiring that makes
 * them visible to users — n8n exposes the same surface from its right
 * sidebar settings pane.
 */

import React from 'react';
import { X, Settings, Bell } from 'lucide-react';
import WorkflowSettingsPanel from '../panels/WorkflowSettingsPanel';
import ErrorNotificationConfig from '../panels/ErrorNotificationConfig';

type Tab = 'general' | 'notifications';

export interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  darkMode: boolean;
}

const SettingsDrawer: React.FC<SettingsDrawerProps> = ({ isOpen, onClose, darkMode }) => {
  const [tab, setTab] = React.useState<Tab>('general');

  if (!isOpen) return null;

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'general', label: 'General', icon: <Settings className="w-3.5 h-3.5" /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell className="w-3.5 h-3.5" /> },
  ];

  return (
    <div
      className={`fixed right-0 top-12 bottom-0 w-[420px] z-[200] flex flex-col shadow-2xl border-l animate-in slide-in-from-right duration-200 ${
        darkMode ? 'bg-gray-900 border-gray-700 text-gray-100' : 'bg-white border-gray-200 text-gray-900'
      }`}
      role="dialog"
      aria-label="Workflow settings"
    >
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-semibold">Workflow Settings</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className={`p-1.5 rounded-lg transition-colors ${
            darkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
          }`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className={`flex border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
              tab === t.id
                ? 'border-blue-500 text-blue-500'
                : `border-transparent ${darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'general' && <WorkflowSettingsPanel darkMode={darkMode} />}
        {tab === 'notifications' && <ErrorNotificationConfig darkMode={darkMode} />}
      </div>
    </div>
  );
};

export default SettingsDrawer;

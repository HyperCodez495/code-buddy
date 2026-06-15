/**
 * Error Notification Channel Configuration
 * Configure notification channels for workflow execution failures.
 */

import React, { useState, useCallback } from 'react';
import { Mail, MessageSquare, Globe, Bell } from 'lucide-react';

interface ChannelState {
  email: { enabled: boolean; address: string };
  slack: { enabled: boolean; webhookUrl: string };
  webhook: { enabled: boolean; url: string };
  inApp: { enabled: boolean };
}

interface ErrorNotificationConfigProps {
  darkMode: boolean;
}

const DEFAULT_STATE: ChannelState = {
  email: { enabled: false, address: '' },
  slack: { enabled: false, webhookUrl: '' },
  webhook: { enabled: false, url: '' },
  inApp: { enabled: true },
};

export const ErrorNotificationConfig: React.FC<ErrorNotificationConfigProps> = ({ darkMode }) => {
  const [channels, setChannels] = useState<ChannelState>(DEFAULT_STATE);

  const bg = darkMode ? 'bg-gray-800' : 'bg-white';
  const text = darkMode ? 'text-gray-200' : 'text-gray-800';
  const textMuted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const border = darkMode ? 'border-gray-700' : 'border-gray-200';
  const inputBg = darkMode ? 'bg-gray-700 text-gray-200' : 'bg-gray-50 text-gray-800';
  const toggleOn = 'bg-blue-500';
  const toggleOff = darkMode ? 'bg-gray-600' : 'bg-gray-300';

  const activeCount = [
    channels.email.enabled,
    channels.slack.enabled,
    channels.webhook.enabled,
    channels.inApp.enabled,
  ].filter(Boolean).length;

  const toggleChannel = useCallback((channel: keyof ChannelState) => {
    setChannels((prev) => ({
      ...prev,
      [channel]: { ...prev[channel], enabled: !prev[channel].enabled },
    }));
  }, []);

  const updateField = useCallback(
    <K extends 'email' | 'slack' | 'webhook'>(
      channel: K,
      field: string,
      value: string
    ) => {
      setChannels((prev) => ({
        ...prev,
        [channel]: { ...prev[channel], [field]: value },
      }));
    },
    []
  );

  const renderToggle = (enabled: boolean, onToggle: () => void) => (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${enabled ? toggleOn : toggleOff}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 mt-0.5 ${enabled ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'}`}
      />
    </button>
  );

  return (
    <div className={`p-4 ${bg} ${text} rounded-lg border ${border}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bell size={18} />
          <h3 className="text-sm font-semibold">Error Notifications</h3>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            activeCount > 0
              ? darkMode
                ? 'bg-blue-900 text-blue-300'
                : 'bg-blue-100 text-blue-700'
              : darkMode
                ? 'bg-gray-700 text-gray-400'
                : 'bg-gray-100 text-gray-500'
          }`}
        >
          {activeCount} active channel{activeCount !== 1 ? 's' : ''}
        </span>
      </div>

      <p className={`text-xs ${textMuted} mb-4`}>
        Configure how you get notified when this workflow fails.
      </p>

      {/* Email */}
      <div className={`mb-3 p-3 rounded border ${border}`}>
        <div className="flex items-center justify-between mb-1">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            <Mail size={14} />
            Email
          </label>
          {renderToggle(channels.email.enabled, () => toggleChannel('email'))}
        </div>
        {channels.email.enabled && (
          <input
            type="email"
            placeholder="recipient@example.com"
            value={channels.email.address}
            onChange={(e) => updateField('email', 'address', e.target.value)}
            className={`mt-2 w-full px-3 py-1.5 text-sm rounded border ${border} ${inputBg} focus:outline-none focus:ring-1 focus:ring-blue-500`}
          />
        )}
      </div>

      {/* Slack */}
      <div className={`mb-3 p-3 rounded border ${border}`}>
        <div className="flex items-center justify-between mb-1">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            <MessageSquare size={14} />
            Slack
          </label>
          {renderToggle(channels.slack.enabled, () => toggleChannel('slack'))}
        </div>
        {channels.slack.enabled && (
          <input
            type="url"
            placeholder="https://hooks.slack.com/services/..."
            value={channels.slack.webhookUrl}
            onChange={(e) => updateField('slack', 'webhookUrl', e.target.value)}
            className={`mt-2 w-full px-3 py-1.5 text-sm rounded border ${border} ${inputBg} focus:outline-none focus:ring-1 focus:ring-blue-500`}
          />
        )}
      </div>

      {/* Webhook */}
      <div className={`mb-3 p-3 rounded border ${border}`}>
        <div className="flex items-center justify-between mb-1">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            <Globe size={14} />
            Webhook
          </label>
          {renderToggle(channels.webhook.enabled, () => toggleChannel('webhook'))}
        </div>
        {channels.webhook.enabled && (
          <input
            type="url"
            placeholder="https://api.example.com/webhook"
            value={channels.webhook.url}
            onChange={(e) => updateField('webhook', 'url', e.target.value)}
            className={`mt-2 w-full px-3 py-1.5 text-sm rounded border ${border} ${inputBg} focus:outline-none focus:ring-1 focus:ring-blue-500`}
          />
        )}
      </div>

      {/* In-App */}
      <div className={`mb-1 p-3 rounded border ${border}`}>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            <Bell size={14} />
            In-App Notification
          </label>
          {renderToggle(channels.inApp.enabled, () => toggleChannel('inApp'))}
        </div>
        <p className={`mt-1 text-xs ${textMuted}`}>
          Shows a notification in the app when the workflow fails.
        </p>
      </div>
    </div>
  );
};

export default React.memo(ErrorNotificationConfig);

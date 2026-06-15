/**
 * Workflow Sharing Component
 * Share workflows with team members or make them public
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  Share2,
  Copy,
  Check,
  Users,
  Globe,
  Lock,
  Mail,
  X,
  UserPlus,
  Settings,
  Eye,
  Edit2,
  Trash2,
  ChevronDown,
  AlertCircle,
  CheckCircle,
  ExternalLink,
} from 'lucide-react';
import { useWorkflowStore } from '../../store/workflowStore';

interface SharePermission {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  role: 'viewer' | 'editor' | 'admin';
  addedAt: number;
  addedBy: string;
}

interface WorkflowSharingProps {
  workflowId: string;
  workflowName: string;
  isOpen: boolean;
  onClose: () => void;
  permissions?: SharePermission[];
  onPermissionsChange?: (permissions: SharePermission[]) => void;
  isPublic?: boolean;
  onPublicChange?: (isPublic: boolean) => void;
  publicUrl?: string;
}

const ROLE_OPTIONS = [
  {
    value: 'viewer',
    label: 'Viewer',
    description: 'Can view workflow and executions',
    icon: Eye,
  },
  {
    value: 'editor',
    label: 'Editor',
    description: 'Can edit workflow and view executions',
    icon: Edit2,
  },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Full access including sharing settings',
    icon: Settings,
  },
];

const WorkflowSharing: React.FC<WorkflowSharingProps> = ({
  workflowId,
  workflowName,
  isOpen,
  onClose,
  permissions = [],
  onPermissionsChange,
  isPublic = false,
  onPublicChange,
  publicUrl,
}) => {
  const darkMode = useWorkflowStore((state) => state.darkMode);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'viewer' | 'editor' | 'admin'>('viewer');
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showRoleDropdown, setShowRoleDropdown] = useState<string | null>(null);

  // Generate shareable link
  const shareableLink = useMemo(() => {
    if (publicUrl) return publicUrl;
    return `${window.location.origin}/workflows/shared/${workflowId}`;
  }, [publicUrl, workflowId]);

  // Copy to clipboard
  const copyToClipboard = useCallback(async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch (_err) {
      setError('Failed to copy to clipboard');
    }
  }, []);

  // Validate email
  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  // Invite user
  const inviteUser = useCallback(() => {
    if (!inviteEmail.trim()) {
      setError('Please enter an email address');
      return;
    }

    if (!validateEmail(inviteEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    // Check if already invited
    if (permissions.some((p) => p.email.toLowerCase() === inviteEmail.toLowerCase())) {
      setError('This user already has access');
      return;
    }

    const newPermission: SharePermission = {
      id: `perm_${Date.now()}`,
      email: inviteEmail,
      role: inviteRole,
      addedAt: Date.now(),
      addedBy: 'current_user',
    };

    onPermissionsChange?.([...permissions, newPermission]);
    setInviteEmail('');
    setSuccess(`Invitation sent to ${inviteEmail}`);
    setError(null);
    setTimeout(() => setSuccess(null), 3000);
  }, [inviteEmail, inviteRole, permissions, onPermissionsChange]);

  // Update permission role
  const updatePermissionRole = useCallback(
    (permId: string, newRole: 'viewer' | 'editor' | 'admin') => {
      onPermissionsChange?.(
        permissions.map((p) => (p.id === permId ? { ...p, role: newRole } : p))
      );
      setShowRoleDropdown(null);
    },
    [permissions, onPermissionsChange]
  );

  // Remove permission
  const removePermission = useCallback(
    (permId: string) => {
      onPermissionsChange?.(permissions.filter((p) => p.id !== permId));
    },
    [permissions, onPermissionsChange]
  );

  // Get role icon
  const getRoleIcon = (role: string) => {
    const option = ROLE_OPTIONS.find((r) => r.value === role);
    return option?.icon || Eye;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className={`w-full max-w-lg max-h-[90vh] overflow-hidden rounded-xl shadow-2xl ${
          darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'
        }`}
      >
        {/* Header */}
        <div
          className={`p-4 border-b flex items-center justify-between ${
            darkMode ? 'border-gray-700' : 'border-gray-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-blue-500" />
            <h2 className="font-semibold">Share Workflow</h2>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* Workflow name */}
          <div className={`p-3 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
            <div className="text-sm text-gray-500 mb-1">Sharing</div>
            <div className="font-medium">{workflowName}</div>
          </div>

          {/* Error/Success messages */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-red-500 text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center gap-2 text-green-500 text-sm">
              <CheckCircle className="w-4 h-4" />
              {success}
            </div>
          )}

          {/* Public access toggle */}
          <div
            className={`p-4 rounded-lg border ${
              darkMode ? 'border-gray-700' : 'border-gray-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isPublic ? (
                  <Globe className="w-5 h-5 text-green-500" />
                ) : (
                  <Lock className="w-5 h-5 text-gray-400" />
                )}
                <div>
                  <div className="font-medium">Public Access</div>
                  <div className="text-sm text-gray-500">
                    {isPublic
                      ? 'Anyone with the link can view'
                      : 'Only invited people can access'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => onPublicChange?.(!isPublic)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  isPublic ? 'bg-green-500' : darkMode ? 'bg-gray-700' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    isPublic ? 'left-7' : 'left-1'
                  }`}
                />
              </button>
            </div>

            {/* Shareable link */}
            {isPublic && (
              <div className="mt-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={shareableLink}
                    readOnly
                    className={`flex-1 px-3 py-2 rounded-lg text-sm ${
                      darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
                    } border`}
                  />
                  <button
                    onClick={() => copyToClipboard(shareableLink, 'link')}
                    className={`px-3 py-2 rounded-lg flex items-center gap-2 ${
                      copied === 'link'
                        ? 'bg-green-500 text-white'
                        : 'bg-blue-500 text-white hover:bg-blue-600'
                    }`}
                  >
                    {copied === 'link' ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                    {copied === 'link' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <a
                  href={shareableLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 text-sm text-blue-500 hover:underline flex items-center gap-1"
                >
                  Open in new tab <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>

          {/* Invite people */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-5 h-5 text-blue-500" />
              <h3 className="font-medium">Invite People</h3>
            </div>

            <div className="flex gap-2 mb-4">
              <div className="relative flex-1">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Enter email address"
                  className={`w-full pl-9 pr-3 py-2 rounded-lg text-sm ${
                    darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
                  } border`}
                  onKeyDown={(e) => e.key === 'Enter' && inviteUser()}
                />
              </div>

              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'viewer' | 'editor' | 'admin')}
                className={`px-3 py-2 rounded-lg text-sm ${
                  darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
                } border`}
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>

              <button
                onClick={inviteUser}
                className="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 flex items-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                Invite
              </button>
            </div>

            {/* People with access */}
            {permissions.length > 0 && (
              <div
                className={`rounded-lg border divide-y ${
                  darkMode ? 'border-gray-700 divide-gray-700' : 'border-gray-200 divide-gray-200'
                }`}
              >
                {permissions.map((permission) => {
                  const RoleIcon = getRoleIcon(permission.role);

                  return (
                    <div
                      key={permission.id}
                      className={`p-3 flex items-center justify-between ${
                        darkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {permission.avatar ? (
                          <img
                            src={permission.avatar}
                            alt={permission.name || permission.email}
                            className="w-8 h-8 rounded-full"
                          />
                        ) : (
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                              darkMode ? 'bg-gray-700' : 'bg-gray-200'
                            }`}
                          >
                            {permission.email.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="text-sm font-medium">
                            {permission.name || permission.email}
                          </div>
                          {permission.name && (
                            <div className="text-xs text-gray-500">{permission.email}</div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Role dropdown */}
                        <div className="relative">
                          <button
                            onClick={() =>
                              setShowRoleDropdown(
                                showRoleDropdown === permission.id ? null : permission.id
                              )
                            }
                            className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm ${
                              darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                            }`}
                          >
                            <RoleIcon className="w-4 h-4 text-gray-400" />
                            <span className="capitalize">{permission.role}</span>
                            <ChevronDown className="w-3 h-3 text-gray-400" />
                          </button>

                          {showRoleDropdown === permission.id && (
                            <div
                              className={`absolute right-0 top-full mt-1 w-48 rounded-lg shadow-lg border z-10 ${
                                darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                              }`}
                            >
                              {ROLE_OPTIONS.map((role) => {
                                const Icon = role.icon;
                                return (
                                  <button
                                    key={role.value}
                                    onClick={() =>
                                      updatePermissionRole(
                                        permission.id,
                                        role.value as 'viewer' | 'editor' | 'admin'
                                      )
                                    }
                                    className={`w-full px-3 py-2 text-left flex items-start gap-2 ${
                                      permission.role === role.value
                                        ? 'bg-blue-500/10 text-blue-500'
                                        : darkMode
                                        ? 'hover:bg-gray-700'
                                        : 'hover:bg-gray-100'
                                    }`}
                                  >
                                    <Icon className="w-4 h-4 mt-0.5" />
                                    <div>
                                      <div className="text-sm font-medium">{role.label}</div>
                                      <div className="text-xs text-gray-500">{role.description}</div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Remove button */}
                        <button
                          onClick={() => removePermission(permission.id)}
                          className={`p-1 rounded ${
                            darkMode ? 'hover:bg-red-900/30' : 'hover:bg-red-100'
                          }`}
                          title="Remove access"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {permissions.length === 0 && (
              <div
                className={`p-8 text-center rounded-lg ${
                  darkMode ? 'bg-gray-800' : 'bg-gray-100'
                }`}
              >
                <Users className="w-10 h-10 mx-auto mb-2 text-gray-400" />
                <p className="text-sm text-gray-500">
                  No one else has access yet.
                  <br />
                  Invite people to collaborate.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className={`p-4 border-t flex justify-end ${
            darkMode ? 'border-gray-700' : 'border-gray-200'
          }`}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkflowSharing;

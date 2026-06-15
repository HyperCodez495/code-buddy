/**
 * ExportTemplateDialog Component
 * Modal dialog for exporting a workflow as a reusable template with metadata.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, Download, Tag, FileText } from 'lucide-react';

const CATEGORIES = [
  'Automation',
  'Data Processing',
  'Integration',
  'Communication',
  'Analytics',
  'DevOps',
  'Custom',
] as const;

type TemplateCategory = (typeof CATEGORIES)[number];

export interface TemplateMetadata {
  name: string;
  description: string;
  category: TemplateCategory;
  tags: string[];
  version: string;
  author: string;
  createdAt: string;
}

export interface TemplateExportData {
  template: TemplateMetadata;
  workflow: {
    nodes: unknown[];
    edges: unknown[];
    settings?: Record<string, unknown>;
  };
}

export interface ExportTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (data: TemplateExportData) => void;
  workflowName: string;
  darkMode?: boolean;
}

export const ExportTemplateDialog: React.FC<ExportTemplateDialogProps> = ({
  isOpen,
  onClose,
  onExport,
  workflowName,
  darkMode = false,
}) => {
  const [name, setName] = useState(workflowName);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TemplateCategory>('Automation');
  const [tagsInput, setTagsInput] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [author, setAuthor] = useState('');

  // Reset form when dialog opens with fresh workflow name
  useEffect(() => {
    if (isOpen) {
      setName(workflowName);
      setDescription('');
      setCategory('Automation');
      setTagsInput('');
      setVersion('1.0.0');
      setAuthor('');
    }
  }, [isOpen, workflowName]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleExport = useCallback(() => {
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const exportData: TemplateExportData = {
      template: {
        name: name.trim() || workflowName,
        description: description.trim(),
        category,
        tags,
        version: version.trim() || '1.0.0',
        author: author.trim(),
        createdAt: new Date().toISOString(),
      },
      workflow: {
        nodes: [],
        edges: [],
        settings: {},
      },
    };

    onExport(exportData);
  }, [name, description, category, tagsInput, version, author, workflowName, onExport]);

  if (!isOpen) return null;

  // Shared style tokens
  const bg = darkMode ? 'bg-gray-800' : 'bg-white';
  const overlay = 'bg-black/50';
  const textPrimary = darkMode ? 'text-gray-100' : 'text-gray-900';
  const textSecondary = darkMode ? 'text-gray-400' : 'text-gray-500';
  const labelColor = darkMode ? 'text-gray-300' : 'text-gray-700';
  const inputBg = darkMode ? 'bg-gray-900' : 'bg-gray-50';
  const inputBorder = darkMode ? 'border-gray-600' : 'border-gray-300';
  const inputText = darkMode ? 'text-gray-200' : 'text-gray-800';
  const focusRing = 'focus:outline-none focus:ring-2 focus:ring-blue-500';

  const inputClasses = `w-full rounded-md border p-2 text-sm ${inputBg} ${inputBorder} ${inputText} ${focusRing}`;
  const labelClasses = `block text-sm font-medium mb-1 ${labelColor}`;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${overlay}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`
          ${bg} rounded-xl shadow-2xl border
          ${darkMode ? 'border-gray-700' : 'border-gray-200'}
          w-full max-w-lg mx-4
        `}
        role="dialog"
        aria-modal="true"
        aria-label="Export as Template"
      >
        {/* Header */}
        <div
          className={`
            flex items-center justify-between px-6 py-4 border-b
            ${darkMode ? 'border-gray-700' : 'border-gray-200'}
          `}
        >
          <div className="flex items-center gap-2">
            <FileText size={20} className={darkMode ? 'text-blue-400' : 'text-blue-600'} />
            <h2 className={`text-lg font-semibold ${textPrimary}`}>Export as Template</h2>
          </div>
          <button
            onClick={onClose}
            className={`
              p-1 rounded-md transition-colors
              ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}
            `}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Template Name */}
          <div>
            <label htmlFor="template-name" className={labelClasses}>
              Template Name
            </label>
            <input
              id="template-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClasses}
              placeholder="My Workflow Template"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="template-description" className={labelClasses}>
              Description
            </label>
            <textarea
              id="template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${inputClasses} resize-none h-24`}
              placeholder="Describe what this template does..."
            />
          </div>

          {/* Category */}
          <div>
            <label htmlFor="template-category" className={labelClasses}>
              Category
            </label>
            <select
              id="template-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as TemplateCategory)}
              className={inputClasses}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label htmlFor="template-tags" className={labelClasses}>
              <span className="flex items-center gap-1">
                <Tag size={14} />
                Tags
              </span>
            </label>
            <input
              id="template-tags"
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className={inputClasses}
              placeholder="api, automation, email (comma-separated)"
            />
            {tagsInput && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tagsInput
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .map((tag, i) => (
                    <span
                      key={i}
                      className={`
                        inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                        ${darkMode ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-700'}
                      `}
                    >
                      {tag}
                    </span>
                  ))}
              </div>
            )}
          </div>

          {/* Version and Author row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="template-version" className={labelClasses}>
                Version
              </label>
              <input
                id="template-version"
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className={inputClasses}
                placeholder="1.0.0"
              />
            </div>
            <div>
              <label htmlFor="template-author" className={labelClasses}>
                Author
              </label>
              <input
                id="template-author"
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className={inputClasses}
                placeholder="Your name"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className={`
            flex items-center justify-between px-6 py-4 border-t
            ${darkMode ? 'border-gray-700' : 'border-gray-200'}
          `}
        >
          <p className={`text-xs ${textSecondary}`}>
            Template will be exported as a JSON file
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className={`
                px-4 py-2 text-sm rounded-lg transition-colors
                ${darkMode
                  ? 'text-gray-300 hover:bg-gray-700'
                  : 'text-gray-700 hover:bg-gray-100'
                }
              `}
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={!name.trim()}
              className={`
                flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
                transition-colors
                ${!name.trim()
                  ? 'opacity-50 cursor-not-allowed bg-blue-400 text-white'
                  : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'
                }
              `}
            >
              <Download size={16} />
              Export Template
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExportTemplateDialog;

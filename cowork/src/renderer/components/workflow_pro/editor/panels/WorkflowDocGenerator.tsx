/**
 * Workflow Documentation Generator
 * Automatically generates documentation for workflows
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useWorkflowStore } from '../../../../store/workflowStore';
import type { WorkflowNode, NodeData } from '../../../../types/workflow';
import {
  FileText,
  Download,
  Copy,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Eye,
} from 'lucide-react';

// Extended NodeData interface with optional properties used in documentation
interface ExtendedNodeData extends NodeData {
  category?: string;
  description?: string;
  hasErrorOutput?: boolean;
}

interface DocSection {
  id: string;
  title: string;
  enabled: boolean;
}

interface WorkflowDocGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
}

const WorkflowDocGeneratorComponent: React.FC<WorkflowDocGeneratorProps> = ({
  isOpen,
  onClose,
}) => {
  const nodes = useWorkflowStore((state) => state.nodes) as Array<WorkflowNode & { data: ExtendedNodeData }>;
  const edges = useWorkflowStore((state) => state.edges);
  const workflowName = useWorkflowStore((state) => state.workflowName);
  const darkMode = useWorkflowStore((state) => state.darkMode);

  // Generate workflow description from nodes and edges
  const workflowDescription = useMemo(() => {
    if (nodes.length === 0) return 'Empty workflow';
    const categories = new Set(nodes.map(n => n.data.category).filter(Boolean));
    const categoryText = categories.size > 0 ? Array.from(categories).join(', ') : 'various';
    return `A workflow with ${nodes.length} nodes and ${edges.length} connections, utilizing ${categoryText} integrations.`;
  }, [nodes, edges]);

  const [format, setFormat] = useState<'markdown' | 'html' | 'json'>('markdown');
  const [copied, setCopied] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(true);
  const [sections, setSections] = useState<DocSection[]>([
    { id: 'overview', title: 'Overview', enabled: true },
    { id: 'nodes', title: 'Nodes', enabled: true },
    { id: 'connections', title: 'Connections', enabled: true },
    { id: 'dataFlow', title: 'Data Flow', enabled: true },
    { id: 'inputs', title: 'Inputs & Triggers', enabled: true },
    { id: 'outputs', title: 'Outputs', enabled: true },
    { id: 'errorHandling', title: 'Error Handling', enabled: true },
  ]);

  // Toggle section
  const toggleSection = useCallback((id: string) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  }, []);

  // Get trigger nodes
  const triggerNodes = useMemo(() => {
    return nodes.filter(
      (n) =>
        n.data?.category === 'triggers' ||
        n.type?.includes('trigger') ||
        n.type?.includes('webhook')
    );
  }, [nodes]);

  // Get output nodes
  const outputNodes = useMemo(() => {
    // Nodes with no outgoing edges
    const _nodeIds = new Set(nodes.map((n) => n.id));
    const nodesWithOutgoing = new Set(edges.map((e) => e.source));
    return nodes.filter((n) => !nodesWithOutgoing.has(n.id));
  }, [nodes, edges]);

  // Get error handling nodes
  const errorNodes = useMemo(() => {
    return nodes.filter(
      (n) =>
        n.type?.includes('error') ||
        n.data?.hasErrorOutput ||
        n.data?.category === 'error-handling'
    );
  }, [nodes]);

  // Generate markdown documentation
  const generateMarkdown = useCallback(() => {
    const enabledSections = sections.filter((s) => s.enabled).map((s) => s.id);
    let doc = '';

    // Title
    doc += `# ${workflowName || 'Untitled Workflow'}\n\n`;

    if (enabledSections.includes('overview')) {
      doc += `## Overview\n\n`;
      doc += `${workflowDescription || 'No description provided.'}\n\n`;
      doc += `- **Total Nodes**: ${nodes.length}\n`;
      doc += `- **Total Connections**: ${edges.length}\n`;
      doc += `- **Triggers**: ${triggerNodes.length}\n`;
      doc += `- **Output Points**: ${outputNodes.length}\n\n`;
    }

    if (enabledSections.includes('inputs')) {
      doc += `## Inputs & Triggers\n\n`;
      if (triggerNodes.length === 0) {
        doc += `No trigger nodes found. This workflow may be manually triggered.\n\n`;
      } else {
        triggerNodes.forEach((node) => {
          doc += `### ${node.data?.label || node.id}\n\n`;
          doc += `- **Type**: ${node.type || 'Unknown'}\n`;
          if (node.data?.description) {
            doc += `- **Description**: ${node.data.description}\n`;
          }
          doc += `\n`;
        });
      }
    }

    if (enabledSections.includes('nodes')) {
      doc += `## Nodes\n\n`;
      doc += `| Node | Type | Description |\n`;
      doc += `|------|------|-------------|\n`;
      nodes.forEach((node) => {
        const label = (node.data?.label as string) || node.id;
        const type = node.type || 'default';
        const desc = (node.data?.description as string) || '-';
        doc += `| ${label} | ${type} | ${desc} |\n`;
      });
      doc += `\n`;
    }

    if (enabledSections.includes('connections')) {
      doc += `## Connections\n\n`;
      if (edges.length === 0) {
        doc += `No connections defined.\n\n`;
      } else {
        edges.forEach((edge) => {
          const sourceNode = nodes.find((n) => n.id === edge.source);
          const targetNode = nodes.find((n) => n.id === edge.target);
          const sourceLabel = (sourceNode?.data?.label as string) || edge.source;
          const targetLabel = (targetNode?.data?.label as string) || edge.target;
          doc += `- **${sourceLabel}** → **${targetLabel}**\n`;
        });
        doc += `\n`;
      }
    }

    if (enabledSections.includes('dataFlow')) {
      doc += `## Data Flow\n\n`;
      doc += `\`\`\`\n`;
      // Simple flow diagram
      const processed = new Set<string>();
      const printFlow = (nodeId: string, indent: number = 0) => {
        if (processed.has(nodeId)) return;
        processed.add(nodeId);
        const node = nodes.find((n) => n.id === nodeId);
        const label = (node?.data?.label as string) || nodeId;
        doc += `${'  '.repeat(indent)}${indent > 0 ? '└── ' : ''}${label}\n`;

        const outgoing = edges.filter((e) => e.source === nodeId);
        outgoing.forEach((edge) => {
          printFlow(edge.target, indent + 1);
        });
      };

      // Start from trigger nodes or nodes with no incoming edges
      const startNodes = triggerNodes.length > 0
        ? triggerNodes
        : nodes.filter((n) => !edges.some((e) => e.target === n.id));

      startNodes.forEach((node) => printFlow(node.id));
      doc += `\`\`\`\n\n`;
    }

    if (enabledSections.includes('outputs')) {
      doc += `## Outputs\n\n`;
      if (outputNodes.length === 0) {
        doc += `No output nodes identified.\n\n`;
      } else {
        outputNodes.forEach((node) => {
          doc += `- **${node.data?.label || node.id}** (${node.type || 'Unknown'})\n`;
        });
        doc += `\n`;
      }
    }

    if (enabledSections.includes('errorHandling')) {
      doc += `## Error Handling\n\n`;
      if (errorNodes.length === 0) {
        doc += `No explicit error handling nodes. Consider adding error handling for production use.\n\n`;
      } else {
        doc += `This workflow includes error handling through:\n\n`;
        errorNodes.forEach((node) => {
          doc += `- **${node.data?.label || node.id}**: ${node.data?.description || 'Error handler'}\n`;
        });
        doc += `\n`;
      }
    }

    // Footer
    doc += `---\n\n`;
    doc += `*Generated on ${new Date().toLocaleString()}*\n`;

    return doc;
  }, [nodes, edges, workflowName, workflowDescription, triggerNodes, outputNodes, errorNodes, sections]);

  // Generate HTML documentation
  const generateHtml = useCallback(() => {
    const markdown = generateMarkdown();
    // Simple markdown to HTML conversion
    let html = `<!DOCTYPE html>
<html>
<head>
  <title>${workflowName || 'Workflow Documentation'}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
    h1 { color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    h2 { color: #374151; margin-top: 2rem; }
    h3 { color: #4b5563; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #e5e7eb; padding: 0.5rem; text-align: left; }
    th { background: #f3f4f6; }
    pre { background: #f3f4f6; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; }
    code { background: #f3f4f6; padding: 0.125rem 0.25rem; border-radius: 0.25rem; }
    ul { padding-left: 1.5rem; }
    li { margin: 0.25rem 0; }
  </style>
</head>
<body>
`;

    // Convert markdown to HTML (simplified)
    html += markdown
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
      .replace(/^- (.*$)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n)+/g, '<ul>$&</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^\|.*\|$/gm, (match) => {
        const cells = match.split('|').filter(Boolean);
        if (cells.some((c) => c.includes('---'))) return '';
        const tag = match.includes('Node') && match.includes('Type') ? 'th' : 'td';
        return `<tr>${cells.map((c) => `<${tag}>${c.trim()}</${tag}>`).join('')}</tr>`;
      })
      .replace(/(<tr>.*<\/tr>\n)+/g, '<table>$&</table>')
      .replace(/---/g, '<hr>');

    html += `
</body>
</html>`;

    return html;
  }, [generateMarkdown, workflowName]);

  // Generate JSON documentation
  const generateJson = useCallback(() => {
    return JSON.stringify(
      {
        name: workflowName || 'Untitled Workflow',
        description: workflowDescription || '',
        generated: new Date().toISOString(),
        statistics: {
          totalNodes: nodes.length,
          totalConnections: edges.length,
          triggers: triggerNodes.length,
          outputs: outputNodes.length,
          errorHandlers: errorNodes.length,
        },
        nodes: nodes.map((n) => ({
          id: n.id,
          label: n.data?.label,
          type: n.type,
          description: n.data?.description,
          position: n.position,
        })),
        connections: edges.map((e) => ({
          source: e.source,
          target: e.target,
          sourceLabel: nodes.find((n) => n.id === e.source)?.data?.label,
          targetLabel: nodes.find((n) => n.id === e.target)?.data?.label,
        })),
        triggers: triggerNodes.map((n) => ({
          id: n.id,
          label: n.data?.label,
          type: n.type,
        })),
        outputs: outputNodes.map((n) => ({
          id: n.id,
          label: n.data?.label,
          type: n.type,
        })),
      },
      null,
      2
    );
  }, [nodes, edges, workflowName, workflowDescription, triggerNodes, outputNodes, errorNodes]);

  // Get documentation content based on format
  const documentation = useMemo(() => {
    switch (format) {
      case 'markdown':
        return generateMarkdown();
      case 'html':
        return generateHtml();
      case 'json':
        return generateJson();
      default:
        return generateMarkdown();
    }
  }, [format, generateMarkdown, generateHtml, generateJson]);

  // Copy to clipboard with error handling
  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(documentation);
      setCopied(true);
      const timeoutId = setTimeout(() => setCopied(false), 2000);
      // Return cleanup function (component typically stays mounted for duration)
      return () => clearTimeout(timeoutId);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      // Could add error state here if needed
    }
  }, [documentation]);

  // Download documentation
  const downloadDoc = useCallback(() => {
    const extensions = { markdown: 'md', html: 'html', json: 'json' };
    const mimeTypes = {
      markdown: 'text/markdown',
      html: 'text/html',
      json: 'application/json',
    };

    const blob = new Blob([documentation], { type: mimeTypes[format] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workflowName || 'workflow'}-docs.${extensions[format]}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [documentation, format, workflowName]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed right-4 top-20 w-[500px] max-h-[calc(100vh-6rem)] overflow-hidden rounded-xl shadow-2xl border z-50 flex flex-col ${
        darkMode
          ? 'bg-gray-900 border-gray-700 text-white'
          : 'bg-white border-gray-200 text-gray-900'
      }`}
    >
      {/* Header */}
      <div
        className={`p-4 border-b flex items-center justify-between ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-500" />
          <h3 className="font-semibold">Documentation Generator</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copyToClipboard}
            className={`p-1.5 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
            }`}
            title="Copy to clipboard"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={downloadDoc}
            className="p-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Options */}
      <div
        className={`p-4 border-b space-y-4 ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        {/* Format selection */}
        <div>
          <label className="block text-sm font-medium mb-2">Output Format</label>
          <div className="flex gap-2">
            {(['markdown', 'html', 'json'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-3 py-1.5 text-sm rounded-lg capitalize ${
                  format === f
                    ? 'bg-blue-500 text-white'
                    : darkMode
                    ? 'bg-gray-800 hover:bg-gray-700'
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Section toggles */}
        <div>
          <label className="block text-sm font-medium mb-2">Include Sections</label>
          <div className="flex flex-wrap gap-2">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => toggleSection(section.id)}
                className={`px-2 py-1 text-xs rounded-full ${
                  section.enabled
                    ? 'bg-blue-500 text-white'
                    : darkMode
                    ? 'bg-gray-800 text-gray-400'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {section.title}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <button
          onClick={() => setPreviewExpanded(!previewExpanded)}
          className={`w-full px-4 py-2 flex items-center justify-between text-sm ${
            darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4" />
            <span className="font-medium">Preview</span>
          </div>
          {previewExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>

        {previewExpanded && (
          <div className="flex-1 overflow-y-auto">
            <pre
              className={`p-4 text-xs font-mono whitespace-pre-wrap ${
                darkMode ? 'bg-gray-800' : 'bg-gray-50'
              }`}
            >
              {documentation}
            </pre>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className={`p-3 border-t text-xs text-gray-500 flex items-center justify-between ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        <span>
          {nodes.length} nodes, {edges.length} connections
        </span>
        <span>
          {Math.ceil(documentation.length / 1000)}KB
        </span>
      </div>
    </div>
  );
};

const WorkflowDocGenerator = React.memo(WorkflowDocGeneratorComponent, (prev, next) => {
  return prev.isOpen === next.isOpen;
});

export default WorkflowDocGenerator;

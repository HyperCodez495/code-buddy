import { X, Book } from 'lucide-react';
import { useTranslation } from 'react-i18next';


export function HelpDocs({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
      <div className="bg-background border border-border shadow-2xl rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-border bg-surface/50">
          <div className="flex items-center gap-2 text-text">
            <Book className="w-5 h-5" />
            <h2 className="font-semibold">{t('helpDocs.title', 'Documentation')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-background rounded transition-colors text-text-secondary hover:text-text"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto prose prose-sm prose-invert max-w-none text-text">
          <h1>Code Buddy Studio Documentation</h1>
          <p>Welcome to the Code Buddy Studio documentation. Here are some of the core features:</p>
          
          <h2>Chat</h2>
          <p>
            The core interface for interacting with the AI agent. You can ask questions,
            request code changes, or ask the agent to run commands. The chat interface supports
            rich markdown, code blocks with syntax highlighting, and inline tool usage.
          </p>
          
          <h2>Workflows</h2>
          <p>
            Automate complex tasks by chaining multiple steps together. Workflows allow you to
            define a sequence of prompts and actions that the agent will follow sequentially or
            in parallel. You can inspect workflow executions and approve pending steps.
          </p>
          
          <h2>Fleet</h2>
          <p>
            Connect and orchestrate multiple instances of the AI agent across different machines
            or environments. The Fleet Command Center allows you to dispatch tasks to remote
            agents, monitor their health, and share context seamlessly.
          </p>
          
          <h2>Memory</h2>
          <p>
            The agent maintains long-term memory across sessions. You can inspect its memory
            in the Memory Panel, view recent facts, and adjust its understanding of the project
            and your preferences.
          </p>
        </div>
      </div>
    </div>
  );
}

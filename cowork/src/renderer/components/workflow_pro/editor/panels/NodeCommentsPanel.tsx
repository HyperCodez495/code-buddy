/**
 * NodeCommentsPanel — Notion-style comment thread on a workflow node.
 *
 * Mounted inside the right-pane when a user opens the "Comments" tab on a
 * selected node. Reads/writes through `/api/comments/*` and subscribes to
 * `comment:created` / `comment:updated` / `comment:deleted` socket events
 * so other collaborators see new threads instantly.
 *
 * The component is intentionally self-contained: it manages its own data,
 * loading state, and optimistic-update on submit. The parent only needs
 * to pass `workflowId` + `nodeId`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Check, X, Send, Trash2 } from 'lucide-react';

interface CommentUser {
  id: string;
  name?: string;
  email: string;
}

interface Comment {
  id: string;
  workflowId: string;
  userId: string;
  nodeId: string | null;
  content: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
  user?: CommentUser;
}

interface Props {
  workflowId: string;
  nodeId: string;
  currentUserId?: string;
  darkMode?: boolean;
}

export const NodeCommentsPanel: React.FC<Props> = ({ workflowId, nodeId, currentUserId, darkMode = false }) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ nodeId, ...(showResolved ? {} : { resolved: 'false' }) });
      const res = await fetch(`/api/comments/workflow/${encodeURIComponent(workflowId)}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { comments: Comment[] };
      setComments(body.comments);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workflowId, nodeId, showResolved]);

  useEffect(() => { void load(); }, [load]);

  // Subscribe to live updates via the existing collaboration socket bus.
  // The window event is fired by the socket adapter on receipt.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ type: string; workflowId: string; comment?: Comment; commentId?: string }>).detail;
      if (detail.workflowId !== workflowId) return;
      switch (detail.type) {
        case 'comment:created':
          if (detail.comment && detail.comment.nodeId === nodeId) {
            setComments((prev) => [...prev, detail.comment!]);
          }
          break;
        case 'comment:updated':
          if (detail.comment) {
            setComments((prev) => prev.map((c) => (c.id === detail.comment!.id ? detail.comment! : c)));
          }
          break;
        case 'comment:deleted':
          if (detail.commentId) {
            setComments((prev) => prev.filter((c) => c.id !== detail.commentId));
          }
          break;
      }
    };
    window.addEventListener('comment:event', handler as EventListener);
    return () => window.removeEventListener('comment:event', handler as EventListener);
  }, [workflowId, nodeId]);

  const submit = useCallback(async () => {
    const content = draft.trim();
    if (!content || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/comments/workflow/${encodeURIComponent(workflowId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, nodeId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { comment: Comment };
      setComments((prev) => [...prev, body.comment]);
      setDraft('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [draft, submitting, workflowId, nodeId]);

  const toggleResolved = useCallback(async (c: Comment) => {
    try {
      const res = await fetch(`/api/comments/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: !c.resolved }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { comment: Comment };
      setComments((prev) => prev.map((x) => (x.id === c.id ? body.comment : x)));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    if (!confirm('Delete this comment?')) return;
    try {
      const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const surface = darkMode ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900';
  const border = darkMode ? 'border-gray-700' : 'border-gray-200';

  return (
    <div className={`${surface} rounded-lg border ${border} flex flex-col h-full`}>
      <div className={`flex items-center justify-between px-4 py-2 border-b ${border}`}>
        <div className="flex items-center gap-2 text-sm font-medium">
          <MessageCircle className="w-4 h-4" />
          Comments
          {comments.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
              {comments.length}
            </span>
          )}
        </div>
        <label className="text-xs flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          Show resolved
        </label>
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-amber-600 border-b border-amber-200 bg-amber-50">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {loading ? (
          <div className="text-xs text-center text-gray-500 py-4">Loading…</div>
        ) : comments.length === 0 ? (
          <div className="text-xs text-center text-gray-500 py-6">
            No comments yet. Start a thread below.
          </div>
        ) : (
          comments.map((c) => (
            <div
              key={c.id}
              className={`rounded-md p-2 text-sm ${
                c.resolved
                  ? darkMode ? 'bg-gray-800/50 opacity-60' : 'bg-gray-50 opacity-60'
                  : darkMode ? 'bg-gray-800' : 'bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">
                  {c.user?.name || c.user?.email || 'Unknown'}
                </span>
                <span className="text-[10px] text-gray-500">
                  {new Date(c.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words">{c.content}</p>
              <div className="flex items-center gap-2 mt-1.5 text-xs">
                <button
                  onClick={() => toggleResolved(c)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-black/10"
                  title={c.resolved ? 'Reopen' : 'Resolve'}
                >
                  {c.resolved ? <X className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                  {c.resolved ? 'Reopen' : 'Resolve'}
                </button>
                {currentUserId === c.userId && (
                  <button
                    onClick={() => remove(c.id)}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-red-100 hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className={`px-3 py-2 border-t ${border}`}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Leave a comment… (use @ to mention coming soon)"
          rows={2}
          className={`w-full text-sm rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border border-gray-200'
          }`}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="flex justify-end mt-1.5">
          <button
            onClick={submit}
            disabled={submitting || draft.trim().length === 0}
            className={`flex items-center gap-1 px-3 py-1 rounded text-xs font-medium ${
              submitting || draft.trim().length === 0
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <Send className="w-3 h-3" />
            {submitting ? 'Sending…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NodeCommentsPanel;

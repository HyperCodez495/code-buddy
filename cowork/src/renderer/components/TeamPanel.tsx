/**
 * TeamPanel — Agent Team observability UI (Phase 4 layer 9).
 *
 * Surfaces the core TeamManager state: lifecycle (active/dissolved),
 * members with their roles + status, shared task list, and a mailbox
 * tail. Backed by the TeamBridge in main/agent/team-bridge.ts which
 * subscribes to TeamManager EventEmitter and forwards 8 event types
 * to this renderer.
 *
 * @module cowork/renderer/components/TeamPanel
 */

import { useEffect, useMemo, useState } from 'react';
import {
  X,
  Users,
  UserPlus,
  Play,
  Square,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Mail,
} from 'lucide-react';
import { useAppStore } from '../store';
import type { TeamMemberStatus, TeamTaskStatus } from '../types';

const VALID_ROLES = [
  'orchestrator',
  'coder',
  'reviewer',
  'tester',
  'researcher',
  'debugger',
  'architect',
  'documenter',
] as const;

const MEMBER_STATUS_TOKEN: Record<TeamMemberStatus, string> = {
  idle: 'text-text-muted',
  working: 'text-accent',
  done: 'text-success',
  error: 'text-error',
};

const TASK_STATUS_TOKEN: Record<TeamTaskStatus, string> = {
  pending: 'text-text-muted',
  in_progress: 'text-accent',
  completed: 'text-success',
  failed: 'text-error',
};

function MemberStatusIcon({ status }: { status: TeamMemberStatus }) {
  const cls = MEMBER_STATUS_TOKEN[status] ?? 'text-text-muted';
  switch (status) {
    case 'working':
      return <Clock className={`w-3.5 h-3.5 ${cls} animate-pulse`} />;
    case 'done':
      return <CheckCircle2 className={`w-3.5 h-3.5 ${cls}`} />;
    case 'error':
      return <AlertCircle className={`w-3.5 h-3.5 ${cls}`} />;
    default:
      return <span className={`text-[10px] ${cls}`}>idle</span>;
  }
}

export function TeamPanel() {
  const show = useAppStore((s) => s.showTeamPanel);
  const setShow = useAppStore((s) => s.setShowTeamPanel);
  const team = useAppStore((s) => s.team);
  const members = useAppStore((s) => s.teamMembers);
  const tasks = useAppStore((s) => s.teamTasks);
  const mailbox = useAppStore((s) => s.teamMailbox);
  const setTeamSnapshot = useAppStore((s) => s.setTeamSnapshot);

  const [showStartModal, setShowStartModal] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [memberRole, setMemberRole] = useState<string>('coder');
  const [memberLabel, setMemberLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const teamApi = window.electronAPI?.team;

  const memberList = useMemo(() => Object.values(members), [members]);
  const taskList = useMemo(
    () =>
      Object.values(tasks).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      ),
    [tasks]
  );

  useEffect(() => {
    if (!show) return;
    if (!teamApi) return;
    void teamApi.getStatus().then((snapshot) => {
      const snap = snapshot as
        | (typeof team & { error?: string })
        | { error: string };
      if (!snap || (snap as { error?: string }).error) return;
      setTeamSnapshot(snap as typeof team);
    });
  }, [show, teamApi, setTeamSnapshot]);

  if (!show) return null;

  const isActive = team?.status === 'active' || team?.status === 'paused';

  const handleStart = async () => {
    setErrorMsg(null);
    if (!teamApi) {
      setErrorMsg('Team bridge unavailable in browser preview. Open the desktop app to manage teams.');
      return;
    }
    const result = await teamApi.start(goalInput.trim() || undefined);
    if (!result.success) {
      setErrorMsg(result.message);
      return;
    }
    setGoalInput('');
    setShowStartModal(false);
  };

  const handleStop = async () => {
    if (!window.confirm('Dissolve the team?')) return;
    if (!teamApi) return;
    await teamApi.stop();
  };

  const handleAddMember = async () => {
    setErrorMsg(null);
    if (!teamApi) {
      setErrorMsg('Team bridge unavailable in browser preview. Open the desktop app to manage teams.');
      return;
    }
    const result = await teamApi.addMember(
      memberRole,
      memberLabel.trim() || undefined
    );
    if (!result.success) {
      setErrorMsg(result.message);
      return;
    }
    setMemberLabel('');
    setShowAddMember(false);
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!teamApi) return;
    await teamApi.removeMember(memberId);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-sm"
      data-testid="team-panel"
    >
      <div className="flex h-full w-[560px] flex-col bg-background-secondary border-l border-border shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">
              Agent Team
            </h2>
            {team && (
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full ${
                  isActive
                    ? 'bg-success/10 text-success'
                    : 'bg-surface text-text-muted'
                }`}
              >
                {team.status}
              </span>
            )}
            {team?.uptime && team.uptime !== 'N/A' && (
              <span className="text-[10px] text-text-muted">{team.uptime}</span>
            )}
          </div>
          <button
            onClick={() => setShow(false)}
            className="rounded p-1 hover:bg-surface transition-colors"
            aria-label="Close team panel"
          >
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        {/* Top action bar */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2 gap-2">
          {!isActive ? (
            <button
              onClick={() => setShowStartModal(true)}
              data-testid="team-start-button"
              className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              Start team
            </button>
          ) : (
            <>
              <button
                onClick={() => setShowAddMember(true)}
                className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Add member
              </button>
              <button
                onClick={handleStop}
                className="flex items-center gap-1 rounded bg-error/10 px-2 py-1 text-xs font-medium text-error hover:bg-error/20 transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
                Stop
              </button>
            </>
          )}
        </div>

        {/* Start modal */}
        {showStartModal && (
          <div className="space-y-2 border-b border-border px-4 py-3">
            <label className="text-[10px] uppercase tracking-wide text-text-muted">
              Team goal (optional)
            </label>
            <textarea
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              data-testid="team-goal-input"
              placeholder="e.g. Refactor the auth middleware for compliance"
              rows={3}
              className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
            />
            {errorMsg && (
              <p className="text-xs text-error flex items-center gap-1" data-testid="team-error">
                <AlertCircle className="w-3 h-3" />
                {errorMsg}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowStartModal(false)}
                className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleStart}
                data-testid="team-start-confirm"
                className="rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
              >
                Start
              </button>
            </div>
          </div>
        )}

        {/* Add member modal */}
        {showAddMember && (
          <div className="space-y-2 border-b border-border px-4 py-3">
            <label className="text-[10px] uppercase tracking-wide text-text-muted">
              Role
            </label>
            <select
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value)}
              className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
            >
              {VALID_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={memberLabel}
              onChange={(e) => setMemberLabel(e.target.value)}
              placeholder="Label (optional, e.g. lead-coder)"
              className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            {errorMsg && (
              <p className="text-xs text-error flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {errorMsg}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowAddMember(false)}
                className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddMember}
                className="rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* Goal banner */}
        {team?.goal && (
          <div className="border-b border-border bg-surface/40 px-4 py-2">
            <div className="text-[10px] uppercase tracking-wide text-text-muted">
              Goal
            </div>
            <div className="text-xs text-text-primary mt-0.5">{team.goal}</div>
          </div>
        )}

        {/* Members section */}
        <div className="border-b border-border">
          <div className="px-4 py-2">
            <span className="text-xs uppercase tracking-wide text-text-muted">
              Members ({memberList.length})
            </span>
          </div>
          <ul className="max-h-48 overflow-y-auto">
            {memberList.length === 0 && (
              <li className="px-4 py-3 text-xs text-text-muted">
                {!teamApi
                  ? 'Team bridge unavailable in browser preview. Open the desktop app to start or observe teams.'
                  : isActive
                  ? 'No members yet. Click "Add member" to start.'
                  : 'Start a team to add members.'}
              </li>
            )}
            {memberList.map((member) => (
              <li
                key={member.id}
                className="flex items-center gap-2 px-4 py-2 text-xs hover:bg-surface transition-colors"
              >
                <MemberStatusIcon status={member.status} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-text-primary">
                    {member.label}{' '}
                    <span className="text-[10px] text-text-muted">
                      ({member.role})
                    </span>
                  </div>
                  <div className="text-[10px] text-text-muted">
                    {member.completedTasks} done
                    {member.currentTaskId && (
                      <>
                        {' · current: '}
                        <span className="text-accent">
                          {tasks[member.currentTaskId]?.title ?? member.currentTaskId}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveMember(member.id)}
                  className="rounded p-1 text-text-muted hover:bg-surface hover:text-error transition-colors"
                  title="Remove member"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Tasks section */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="text-xs uppercase tracking-wide text-text-muted">
              Tasks ({taskList.length})
            </span>
            {team?.taskSummary && (
              <span className="text-[10px] text-text-muted">
                {team.taskSummary.pending} pending · {team.taskSummary.inProgress} in progress · {team.taskSummary.completed} done
              </span>
            )}
          </div>
          <ul className="flex-1 overflow-y-auto">
            {taskList.length === 0 && (
              <li className="px-4 py-3 text-xs text-text-muted">
                No tasks yet.
              </li>
            )}
            {taskList.map((task) => {
              const assignee = task.assignedTo
                ? members[task.assignedTo]?.label || 'unknown'
                : 'unassigned';
              return (
                <li
                  key={task.id}
                  className="border-b border-border px-4 py-2 text-xs"
                >
                  <div className="flex items-baseline gap-2">
                    <span className={`font-medium ${TASK_STATUS_TOKEN[task.status as TeamTaskStatus]}`}>
                      [{task.status}]
                    </span>
                    <span className="text-text-primary truncate flex-1">
                      {task.title}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {task.priority}
                    </span>
                  </div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    → {assignee}
                  </div>
                  {task.error && (
                    <div className="text-[10px] text-error mt-0.5">{task.error}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Mailbox tail */}
        {mailbox.length > 0 && (
          <div className="border-t border-border max-h-32 flex flex-col overflow-hidden">
            <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border">
              <Mail className="w-3 h-3 text-text-muted" />
              <span className="text-[10px] uppercase tracking-wide text-text-muted">
                Mailbox ({mailbox.length})
              </span>
            </div>
            <ul className="flex-1 overflow-y-auto">
              {mailbox
                .slice()
                .reverse()
                .slice(0, 10)
                .map((msg) => {
                  const fromLabel = members[msg.from]?.label ?? msg.from;
                  const toLabel =
                    msg.to === 'all' ? 'all' : members[msg.to]?.label ?? msg.to;
                  return (
                    <li
                      key={msg.id}
                      className="px-4 py-1 text-[11px] border-b border-border/50"
                    >
                      <span className="text-accent">{fromLabel}</span>
                      <span className="text-text-muted"> → </span>
                      <span className="text-text-secondary">{toLabel}</span>
                      <span className="text-text-muted">: </span>
                      <span className="text-text-primary">{msg.content}</span>
                    </li>
                  );
                })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

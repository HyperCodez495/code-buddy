import { useEffect, useMemo, useState, DragEvent } from 'react';
import {
  X,
  UserPlus,
  Play,
  Square,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Mail,
  Plus,
  GripVertical,
  Activity,
  Cpu
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import type { TeamMemberStatus } from '../types';

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

export function TeamPanel() {
  const { t } = useTranslation();
  const show = useAppStore((s) => s.showTeamPanel);
  const setShow = useAppStore((s) => s.setShowTeamPanel);
  const team = useAppStore((s) => s.team);
  const members = useAppStore((s) => s.teamMembers);
  const tasks = useAppStore((s) => s.teamTasks);
  const mailbox = useAppStore((s) => s.teamMailbox);
  const setTeamSnapshot = useAppStore((s) => s.setTeamSnapshot);

  const [showStartModal, setShowStartModal] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  
  const [goalInput, setGoalInput] = useState('');
  const [memberRole, setMemberRole] = useState<string>('coder');
  const [memberLabel, setMemberLabel] = useState('');
  
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragOverMember, setDragOverMember] = useState<string | null>(null);
  
  const teamApi = window.electronAPI?.team;

  const memberList = useMemo(() => Object.values(members), [members]);
  const taskList = useMemo(
    () => Object.values(tasks).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [tasks]
  );

  useEffect(() => {
    if (!show || !teamApi) return;
    void teamApi.getStatus().then((snapshot) => {
      const snap = snapshot as (typeof team & { error?: string }) | { error: string };
      if (!snap || (snap as { error?: string }).error) return;
      setTeamSnapshot(snap as typeof team);
    });
  }, [show, teamApi, setTeamSnapshot]);

  if (!show) return null;

  const isActive = team?.status === 'active' || team?.status === 'paused';

  const handleStart = async () => {
    setErrorMsg(null);
    if (!teamApi) {
      setErrorMsg(t('team.bridgeUnavailableManage', 'Bridge unavailable.'));
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
    if (!window.confirm(t('team.dissolveConfirm', 'Dissolve the team?'))) return;
    if (!teamApi) return;
    await teamApi.stop();
  };

  const handleAddMember = async () => {
    setErrorMsg(null);
    if (!teamApi) return;
    const result = await teamApi.addMember(memberRole, memberLabel.trim() || undefined);
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

  const handleAddTask = async () => {
    setErrorMsg(null);
    if (!teamApi || !taskTitle.trim()) return;
    await teamApi.addTask({
      title: taskTitle.trim(),
      description: taskDesc.trim(),
    });
    setTaskTitle('');
    setTaskDesc('');
    setShowAddTask(false);
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDropOnMember = async (e: DragEvent<HTMLDivElement>, memberId: string) => {
    e.preventDefault();
    setDragOverMember(null);
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId && teamApi) {
      await teamApi.assignTask(taskId, memberId);
    }
  };

  const renderStatusGlow = (status: TeamMemberStatus) => {
    switch (status) {
      case 'working': return 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.8)] animate-pulse';
      case 'done': return 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]';
      case 'error': return 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.8)] animate-bounce';
      default: return 'bg-slate-500 shadow-[0_0_4px_rgba(100,116,139,0.5)]';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-slate-950/80 backdrop-blur-md" data-testid="team-panel">
      <style>{`
        .korben-panel {
          background: linear-gradient(145deg, rgba(15,23,42,0.95), rgba(2,6,23,0.98));
          border-left: 1px solid rgba(56,189,248,0.2);
          box-shadow: -10px 0 40px rgba(0,0,0,0.8), inset 0 0 30px rgba(56,189,248,0.05);
          font-family: 'Inter', sans-serif;
        }
        .korben-header {
          background: linear-gradient(90deg, rgba(15,23,42,1) 0%, rgba(30,58,138,0.4) 100%);
          border-bottom: 1px solid rgba(56,189,248,0.3);
        }
        .korben-glow-text {
          text-shadow: 0 0 10px rgba(56,189,248,0.5);
        }
        .korben-card {
          background: rgba(30,41,59,0.4);
          border: 1px solid rgba(56,189,248,0.15);
          backdrop-filter: blur(8px);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .korben-card:hover {
          border-color: rgba(56,189,248,0.5);
          box-shadow: 0 4px 20px rgba(56,189,248,0.15);
          transform: translateY(-1px);
        }
        .korben-drop-active {
          border-color: rgba(52,211,153,0.8) !important;
          background: rgba(52,211,153,0.15) !important;
          box-shadow: 0 0 25px rgba(52,211,153,0.3) !important;
          transform: scale(1.02);
        }
        .korben-btn {
          background: rgba(56,189,248,0.1);
          border: 1px solid rgba(56,189,248,0.4);
          color: #38bdf8;
          transition: all 0.2s;
        }
        .korben-btn:hover {
          background: rgba(56,189,248,0.2);
          box-shadow: 0 0 15px rgba(56,189,248,0.3);
        }
        .korben-btn-danger {
          background: rgba(244,63,94,0.1);
          border: 1px solid rgba(244,63,94,0.4);
          color: #f43f5e;
        }
        .korben-btn-danger:hover {
          background: rgba(244,63,94,0.2);
          box-shadow: 0 0 15px rgba(244,63,94,0.3);
        }
        .korben-input {
          background: rgba(15,23,42,0.6);
          border: 1px solid rgba(56,189,248,0.3);
          color: #e2e8f0;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .korben-input:focus {
          outline: none;
          border-color: #38bdf8;
          box-shadow: 0 0 10px rgba(56,189,248,0.2);
        }
        .scroll-sci-fi::-webkit-scrollbar {
          width: 6px;
        }
        .scroll-sci-fi::-webkit-scrollbar-track {
          background: rgba(15,23,42,0.5);
        }
        .scroll-sci-fi::-webkit-scrollbar-thumb {
          background: rgba(56,189,248,0.3);
          border-radius: 3px;
        }
        .scroll-sci-fi::-webkit-scrollbar-thumb:hover {
          background: rgba(56,189,248,0.6);
        }
      `}</style>

      <div className="flex h-full w-[800px] flex-col korben-panel text-slate-300">
        {/* Header */}
        <div className="korben-header flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-sky-400 animate-pulse" />
            <h2 className="text-lg font-bold tracking-widest text-sky-100 korben-glow-text uppercase">
              Fleet Command
            </h2>
            {team && (
              <span className={`ml-3 text-[10px] px-2 py-0.5 rounded-sm uppercase tracking-wider font-bold border ${isActive ? 'border-sky-400 text-sky-400 bg-sky-400/10 shadow-[0_0_8px_rgba(56,189,248,0.3)]' : 'border-slate-500 text-slate-400'}`}>
                {team.status}
              </span>
            )}
            {team?.uptime && team.uptime !== 'N/A' && (
              <span className="text-xs font-mono text-sky-200/60 ml-2">{team.uptime}</span>
            )}
          </div>
          <button onClick={() => setShow(false)} className="rounded-full p-1.5 hover:bg-white/10 transition-colors text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-between border-b border-sky-400/20 px-6 py-3 bg-slate-900/40">
          {!isActive ? (
            <button onClick={() => setShowStartModal(true)} className="korben-btn flex items-center gap-2 rounded px-4 py-1.5 text-sm font-semibold uppercase tracking-wider">
              <Play className="w-4 h-4" /> Start Fleet
            </button>
          ) : (
            <div className="flex gap-3">
              <button onClick={() => setShowAddMember(true)} className="korben-btn flex items-center gap-2 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider">
                <UserPlus className="w-4 h-4" /> Deploy Unit
              </button>
              <button onClick={() => setShowAddTask(true)} className="korben-btn flex items-center gap-2 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider">
                <Plus className="w-4 h-4" /> New Task
              </button>
              <button onClick={handleStop} className="korben-btn-danger flex items-center gap-2 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider">
                <Square className="w-4 h-4" /> Abort
              </button>
            </div>
          )}
        </div>

        {/* Modals Inline */}
        {showStartModal && (
          <div className="border-b border-sky-400/20 px-6 py-4 bg-slate-800/50 backdrop-blur-md">
            <label className="text-[10px] uppercase tracking-widest text-sky-400 mb-1 block font-bold">Mission Objective</label>
            <textarea value={goalInput} onChange={(e) => setGoalInput(e.target.value)} rows={2} className="korben-input w-full rounded p-2 text-sm resize-none mb-3" placeholder="Define the primary directive..." />
            {errorMsg && <p className="text-xs text-rose-400 mb-3 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{errorMsg}</p>}
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowStartModal(false)} className="text-xs uppercase font-bold text-slate-400 hover:text-white">Cancel</button>
              <button onClick={handleStart} className="korben-btn rounded px-4 py-1.5 text-xs font-bold uppercase tracking-wider">Execute</button>
            </div>
          </div>
        )}

        {showAddMember && (
          <div className="border-b border-sky-400/20 px-6 py-4 bg-slate-800/50 backdrop-blur-md">
            <div className="flex gap-3 mb-3">
              <div className="flex-1">
                <label className="text-[10px] uppercase tracking-widest text-sky-400 mb-1 block font-bold">Unit Designation</label>
                <input type="text" value={memberLabel} onChange={(e) => setMemberLabel(e.target.value)} className="korben-input w-full rounded p-2 text-sm" placeholder="e.g. Alpha-1" />
              </div>
              <div className="flex-1">
                <label className="text-[10px] uppercase tracking-widest text-sky-400 mb-1 block font-bold">Role Profile</label>
                <select value={memberRole} onChange={(e) => setMemberRole(e.target.value)} className="korben-input w-full rounded p-2 text-sm">
                  {VALID_ROLES.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                </select>
              </div>
            </div>
            {errorMsg && <p className="text-xs text-rose-400 mb-3 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{errorMsg}</p>}
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowAddMember(false)} className="text-xs uppercase font-bold text-slate-400 hover:text-white">Cancel</button>
              <button onClick={handleAddMember} className="korben-btn rounded px-4 py-1.5 text-xs font-bold uppercase tracking-wider">Deploy</button>
            </div>
          </div>
        )}

        {showAddTask && (
          <div className="border-b border-sky-400/20 px-6 py-4 bg-slate-800/50 backdrop-blur-md">
            <label className="text-[10px] uppercase tracking-widest text-sky-400 mb-1 block font-bold">Task Title</label>
            <input type="text" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} className="korben-input w-full rounded p-2 text-sm mb-3" placeholder="Brief directive..." />
            <label className="text-[10px] uppercase tracking-widest text-sky-400 mb-1 block font-bold">Description</label>
            <textarea value={taskDesc} onChange={(e) => setTaskDesc(e.target.value)} className="korben-input w-full rounded p-2 text-sm resize-none mb-3" rows={2} placeholder="Detailed parameters..." />
            {errorMsg && <p className="text-xs text-rose-400 mb-3 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{errorMsg}</p>}
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowAddTask(false)} className="text-xs uppercase font-bold text-slate-400 hover:text-white">Cancel</button>
              <button onClick={handleAddTask} className="korben-btn rounded px-4 py-1.5 text-xs font-bold uppercase tracking-wider">Queue Task</button>
            </div>
          </div>
        )}

        {/* Main Grid: Members (Left) and Tasks (Right) */}
        <div className="flex flex-1 min-h-0">
          
          {/* Active Units */}
          <div className="w-1/2 border-r border-sky-400/20 flex flex-col p-4">
            <h3 className="text-[11px] font-bold tracking-[0.2em] text-sky-200/60 uppercase mb-4 flex items-center gap-2">
              <Cpu className="w-4 h-4" /> Active Units ({memberList.length})
            </h3>
            <div className="flex-1 overflow-y-auto scroll-sci-fi pr-2 space-y-3">
              {memberList.length === 0 && (
                <div className="text-sm text-slate-500 italic text-center py-10">No units deployed.</div>
              )}
              {memberList.map((member) => (
                <div
                  key={member.id}
                  className={`korben-card rounded-lg p-3 relative overflow-hidden ${dragOverMember === member.id ? 'korben-drop-active' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOverMember(member.id); }}
                  onDragLeave={() => setDragOverMember(null)}
                  onDrop={(e) => handleDropOnMember(e, member.id)}
                >
                  <div className="absolute top-0 left-0 w-1 h-full bg-slate-700">
                    <div className={`w-full h-full ${renderStatusGlow(member.status)}`} />
                  </div>
                  <div className="pl-3 flex justify-between items-start">
                    <div>
                      <div className="font-bold text-sky-100 flex items-center gap-2">
                        {member.label || member.id.substring(0, 8)}
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-sky-400/30 text-sky-300 bg-sky-400/10">
                          {member.role}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1 uppercase tracking-wider">
                        Status: <span className={member.status === 'working' ? 'text-sky-400' : member.status === 'error' ? 'text-rose-400' : 'text-emerald-400'}>{member.status}</span>
                      </div>
                      {member.currentTaskId && (
                        <div className="text-xs text-sky-300 mt-2 p-1.5 bg-sky-900/30 rounded border border-sky-400/20">
                          <span className="text-[9px] text-sky-200/60 block mb-0.5">CURRENT DIRECTIVE</span>
                          {tasks[member.currentTaskId]?.title || member.currentTaskId}
                        </div>
                      )}
                    </div>
                    <button onClick={() => handleRemoveMember(member.id)} className="text-slate-500 hover:text-rose-400 transition-colors p-1">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Task Queue */}
          <div className="w-1/2 flex flex-col p-4">
            <h3 className="text-[11px] font-bold tracking-[0.2em] text-sky-200/60 uppercase mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Mission Queue ({taskList.length})
            </h3>
            <div className="flex-1 overflow-y-auto scroll-sci-fi pr-2 space-y-2">
              {taskList.length === 0 && (
                <div className="text-sm text-slate-500 italic text-center py-10">Queue is empty.</div>
              )}
              {taskList.map((task) => {
                const assignee = task.assignedTo ? members[task.assignedTo]?.label || 'UNIT' : null;
                const isUnassigned = !task.assignedTo && task.status === 'pending';
                return (
                  <div
                    key={task.id}
                    draggable={isUnassigned}
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    className={`korben-card rounded p-2.5 flex gap-3 ${isUnassigned ? 'cursor-grab active:cursor-grabbing border-dashed border-sky-400/40 hover:border-sky-400/80' : ''}`}
                  >
                    {isUnassigned ? (
                      <div className="text-sky-400/50 pt-1 cursor-grab flex-shrink-0">
                        <GripVertical className="w-4 h-4" />
                      </div>
                    ) : (
                      <div className="w-4 flex-shrink-0 flex justify-center pt-1">
                        {task.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                        {task.status === 'in_progress' && <Clock className="w-4 h-4 text-sky-400 animate-pulse" />}
                        {task.status === 'failed' && <AlertCircle className="w-4 h-4 text-rose-400" />}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-semibold truncate ${task.status === 'completed' ? 'text-slate-500 line-through' : 'text-sky-100'}`}>
                        {task.title}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[9px] uppercase tracking-widest px-1.5 py-[1px] rounded ${
                          task.status === 'pending' ? 'bg-slate-700 text-slate-300' :
                          task.status === 'in_progress' ? 'bg-sky-900/50 text-sky-300 border border-sky-400/30' :
                          task.status === 'completed' ? 'bg-emerald-900/30 text-emerald-400' :
                          'bg-rose-900/30 text-rose-400'
                        }`}>
                          {task.status}
                        </span>
                        {assignee ? (
                          <span className="text-[10px] text-sky-200/50">→ {assignee}</span>
                        ) : (
                          <span className="text-[10px] text-amber-400/60 animate-pulse">Awaiting Assignment</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Mailbox Feed */}
            {mailbox.length > 0 && (
              <div className="mt-4 pt-4 border-t border-sky-400/20 h-40 flex flex-col">
                <h3 className="text-[10px] font-bold tracking-[0.2em] text-sky-200/60 uppercase mb-2 flex items-center gap-2">
                  <Mail className="w-3 h-3" /> Comms Log
                </h3>
                <div className="flex-1 overflow-y-auto scroll-sci-fi text-[11px] font-mono leading-relaxed bg-slate-900/50 p-2 rounded border border-sky-400/10">
                  {mailbox.slice().reverse().slice(0, 15).map(msg => (
                    <div key={msg.id} className="mb-1.5 text-slate-400">
                      <span className="text-sky-400 font-bold">{members[msg.from]?.label || msg.from}</span>
                      <span className="text-slate-600"> {'>'} </span>
                      <span className="text-indigo-300">{msg.to === 'all' ? 'ALL' : members[msg.to]?.label || msg.to}</span>
                      <span className="text-slate-600">: </span>
                      <span className="text-sky-100/80">{msg.content}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

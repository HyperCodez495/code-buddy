import { deployTargets, statusTone, type DeployStatus, type DeployTargetId } from './utils/deploy-model.js';

export interface DeployPanelProps { target: DeployTargetId; status: DeployStatus; publicUrl?: string; log?: string; onTargetChange: (target: DeployTargetId) => void; onDeploy: () => void; }
export function DeployPanel({ target, status, publicUrl, log, onTargetChange, onDeploy }: DeployPanelProps) {
  const disabled = status === 'deploying';
  return <section className={'studio2-deploy tone-' + statusTone(status)}>
    <header><h3>Deploy</h3><span>{status}</span></header>
    <label>Target<select value={target} disabled={disabled} onChange={(event) => onTargetChange(event.target.value as DeployTargetId)}>{deployTargets.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
    <p>{deployTargets.find((option) => option.id === target)?.description}</p>
    <button type="button" disabled={disabled} onClick={onDeploy}>{disabled ? 'Deploying…' : 'Deploy'}</button>
    {publicUrl ? <a href={publicUrl}>{publicUrl}</a> : null}
    {log ? <pre>{log}</pre> : null}
  </section>;
}
export default DeployPanel;

export interface OsActionWiringEntry {
  id: string;
  component: string;
  model: string;
  callbacks: string[];
}

export const osActionsWiring: OsActionWiringEntry[] = [
  { id: 'mission-actions', component: 'MissionActionsBar', model: 'mission-action-model', callbacks: ['onPause', 'onResume', 'onCancel', 'onBranch'] },
  { id: 'autonomy-control', component: 'AutonomyControlPanel', model: 'autonomy-control-model', callbacks: ['onPostureChange', 'onDaemonPause', 'onDaemonResume', 'onCostCapChange'] },
  { id: 'route-override', component: 'RouteOverridePanel', model: 'route-override-model', callbacks: ['onOverride'] },
  { id: 'alert-ack', component: 'AlertAckStrip', model: 'alert-model', callbacks: ['onAck', 'onSnooze', 'onEscalate'] },
  { id: 'approval-queue', component: 'ApprovalQueueView', model: 'approval-queue-model', callbacks: ['onToggle', 'onApprove', 'onReject'] },
  { id: 'peer-control', component: 'PeerControlCard', model: 'peer-control-model', callbacks: ['onRoleChange', 'onCapacityChange', 'onAllowlistChange', 'onPause', 'onResume'] },
  { id: 'cost-cap', component: 'CostCapEditor', model: 'cost-cap-model', callbacks: ['onCapChange'] },
  { id: 'command-palette', component: 'CommandPaletteActions', model: 'os-command-actions', callbacks: ['callbackName'] },
];

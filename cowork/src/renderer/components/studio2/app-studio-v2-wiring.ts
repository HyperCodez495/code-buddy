export const appStudioV2Wiring = {
  version: 2,
  panels: ['deploy', 'git', 'diff', 'snapshots', 'chatBridge'],
  ipc: { deploy: 'studio2.deploy.run', gitStatus: 'studio2.git.status', gitCommit: 'studio2.git.commit', gitLog: 'studio2.git.log', exportProject: 'studio2.export.project', importFolder: 'studio2.import.folder' },
  reusesV1: ['dev-server-service', 'studio-files', 'command-runner', 'scaffold-service', 'studio-api'],
} as const;
export default appStudioV2Wiring;

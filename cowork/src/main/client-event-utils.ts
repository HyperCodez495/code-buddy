import type { ClientEvent } from '../renderer/types';

export function eventRequiresSessionManager(event: ClientEvent): boolean {
  switch (event.type) {
    case 'session.start':
    case 'session.continue':
    case 'session.steer':
    case 'session.stop':
    case 'session.delete':
    case 'session.batchDelete':
    case 'session.duplicate':
    case 'session.updateSettings':
    case 'session.list':
    case 'session.getMessages':
    case 'session.getTraceSteps':
    case 'permission.response':
      return true;
    default:
      return false;
  }
}

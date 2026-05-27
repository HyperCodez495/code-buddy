/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FleetPanel } from '../src/renderer/components/FleetPanel';
import { TeamPanel } from '../src/renderer/components/TeamPanel';
import { useAppStore } from '../src/renderer/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function resetPanelState() {
  useAppStore.setState({
    showFleetPanel: false,
    fleetPeers: {},
    fleetEvents: [],
    showTeamPanel: false,
    team: null,
    teamMembers: {},
    teamTasks: {},
    teamMailbox: [],
  });
}

describe('Fleet and Team panels in browser preview', () => {
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    resetPanelState();
    Reflect.deleteProperty(window, 'electronAPI');
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders the Fleet panel without crashing when the Electron fleet bridge is absent', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);
    useAppStore.setState({ showFleetPanel: true });

    act(() => {
      root?.render(React.createElement(FleetPanel));
    });

    expect(target.querySelector('[data-testid="fleet-panel"]')).toBeTruthy();
    expect(target.textContent).toContain('Fleet bridge unavailable in browser preview');
  });

  it('renders the Team panel without crashing when the Electron team bridge is absent', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);
    useAppStore.setState({ showTeamPanel: true });

    act(() => {
      root?.render(React.createElement(TeamPanel));
    });

    expect(target.querySelector('[data-testid="team-panel"]')).toBeTruthy();
    expect(target.textContent).toContain('Team bridge unavailable in browser preview');
  });

  it('uses the Electron bridges when they are available', async () => {
    const fleetList = vi.fn().mockResolvedValue([]);
    const teamStatus = vi.fn().mockResolvedValue(null);
    Object.assign(window, {
      electronAPI: {
        fleet: {
          list: fleetList,
          addPeer: vi.fn(),
          removePeer: vi.fn(),
          reconnect: vi.fn(),
        },
        team: {
          getStatus: teamStatus,
          start: vi.fn(),
          stop: vi.fn(),
          addMember: vi.fn(),
          removeMember: vi.fn(),
        },
      },
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);
    useAppStore.setState({ showFleetPanel: true, showTeamPanel: true });

    await act(async () => {
      root?.render(
        React.createElement(React.Fragment, null, [
          React.createElement(FleetPanel, { key: 'fleet' }),
          React.createElement(TeamPanel, { key: 'team' }),
        ]),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fleetList).toHaveBeenCalledTimes(1);
    expect(teamStatus).toHaveBeenCalledTimes(1);
    expect(target.textContent).not.toContain('bridge unavailable in browser preview');
  });
});

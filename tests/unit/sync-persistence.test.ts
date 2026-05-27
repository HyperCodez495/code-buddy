
import { SyncManager } from '../../src/sync/index.js';

// Mock UnifiedVfsRouter
const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockExists = jest.fn();
const mockEnsureDir = jest.fn();

jest.mock('../../src/services/vfs/unified-vfs-router.js', () => ({
  UnifiedVfsRouter: {
    Instance: {
      readFile: (...args: unknown[]) => mockReadFile(...args),
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
      exists: (...args: unknown[]) => mockExists(...args),
      ensureDir: (...args: unknown[]) => mockEnsureDir(...args),
    },
  },
}));

describe('Sync Persistence', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockExists.mockReset();
    mockEnsureDir.mockReset();
  });

  it('should save state to disk on creation', async () => {
    const manager = new SyncManager();
    // Wait for initial load attempt
    await new Promise(resolve => setTimeout(resolve, 10));
    
    const savePromise = new Promise(resolve => manager.once('saved', resolve));
    manager.createState({ foo: 'bar' });
    await savePromise;
    
    // Check if save was called
    // save() calls ensureDir and writeFile
    expect(mockEnsureDir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalled();
    
    // Check content of writeFile
    const content = mockWriteFile.mock.calls[0][1];
    expect(content).toContain('foo');
    expect(content).toContain('bar');
    manager.dispose();
  });

  it('should load state from disk on init', async () => {
    // Setup mock data for load
    mockExists.mockResolvedValue(true);
    const savedState = {
      nodeId: 'test-node',
      states: [['state1', { id: 'state1', data: { restored: true }, version: 1 }]],
      pendingOperations: []
    };
    mockReadFile.mockResolvedValue(JSON.stringify(savedState));
    
    const manager = new SyncManager();
    
    // Wait for load to complete (it's called in constructor but async)
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const state = manager.getState('state1') as { data: { restored: boolean } } | undefined;
    expect(state).toBeDefined();
    expect(state?.data.restored).toBe(true);
    manager.dispose();
  });

  it('should emit persistence errors when a listener is registered', async () => {
    mockEnsureDir.mockRejectedValueOnce(new Error('disk busy'));
    const manager = new SyncManager();
    await new Promise(resolve => setTimeout(resolve, 10));

    const errorPromise = new Promise(resolve => manager.once('error', resolve));
    manager.createState({ foo: 'bar' });

    await expect(errorPromise).resolves.toMatchObject({ message: 'disk busy' });
    manager.dispose();
  });

  it('should not create unhandled rejections for persistence errors without listeners', async () => {
    mockEnsureDir.mockRejectedValueOnce(new Error('disk busy'));
    const manager = new SyncManager();
    await new Promise(resolve => setTimeout(resolve, 10));

    manager.createState({ foo: 'bar' });

    await new Promise(resolve => setTimeout(resolve, 10));
    manager.dispose();
  });
});

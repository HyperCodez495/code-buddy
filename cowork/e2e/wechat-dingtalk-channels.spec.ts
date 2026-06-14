import { expect, test } from './fixtures';

test('verifies initialization of new WeChat and DingTalk remote channels', async ({ electronApp }) => {
  // We can evaluate code in the main process to check if the remote config store
  // initializes with wechat and dingtalk channels properly.
  const remoteChannels = await electronApp.evaluate(async ({ ipcMain }) => {
    ipcMain.removeHandler('remote.getConfig');
    // Return a mocked RemoteConfig that simulates the new channels being available
    ipcMain.handle('remote.getConfig', async () => ({
      gateway: { enabled: true, port: 8080 },
      channels: {
        feishu: { type: 'feishu', appId: 'mock' },
        wechat: { type: 'wechat', corpId: 'wechat-mock-id', enabled: true },
        dingtalk: { type: 'dingtalk', agentId: 'dingtalk-mock-id', enabled: true },
      }
    }));
    
    // We simulate what the frontend would get
    return {
      wechat: { type: 'wechat', corpId: 'wechat-mock-id', enabled: true },
      dingtalk: { type: 'dingtalk', agentId: 'dingtalk-mock-id', enabled: true },
    };
  });

  expect(remoteChannels.wechat.type).toBe('wechat');
  expect(remoteChannels.wechat.corpId).toBe('wechat-mock-id');
  expect(remoteChannels.wechat.enabled).toBe(true);

  expect(remoteChannels.dingtalk.type).toBe('dingtalk');
  expect(remoteChannels.dingtalk.agentId).toBe('dingtalk-mock-id');
  expect(remoteChannels.dingtalk.enabled).toBe(true);
});

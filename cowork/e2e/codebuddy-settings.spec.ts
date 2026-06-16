import type { Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from './fixtures';

async function startOpenAICompatibleModelServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  requests: string[];
}> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method || 'GET'} ${req.url || '/'}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          { id: 'gpt-local-e2e' },
          { id: 'qwen-e2e:32b' },
        ],
      }));
      return;
    }

    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: 'e2e-real-backend' }));
      return;
    }

    if (req.url === '/api/metrics') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ toolCount: 110 }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => closeServer(server),
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function dismissOnboardingIfPresent(appPage: Page) {
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 1500 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toHaveCount(0);
  }
}

test('selects a Code Buddy model discovered from a real local backend', async ({ appPage }) => {
  const modelServer = await startOpenAICompatibleModelServer();

  try {
    await dismissOnboardingIfPresent(appPage);
    await appPage.getByText('Fichier', { exact: true }).click();
    await appPage.getByText('Paramètres').click();
    await expect(appPage.getByTestId('settings-panel')).toBeVisible({ timeout: 20000 });
    await dismissOnboardingIfPresent(appPage);
    await appPage.getByTestId('settings-tab-codebuddy').click();
    await expect(appPage.getByTestId('settings-codebuddy')).toBeVisible();

    await appPage.getByTestId('codebuddy-endpoint-input').fill(modelServer.baseUrl);
    await appPage.getByTestId('codebuddy-test-connection').click();
    await expect(appPage.getByText('Connected to Code Buddy')).toBeVisible();
    await expect(appPage.getByText('Version: e2e-real-backend')).toBeVisible();
    await appPage.getByTestId('codebuddy-models-refresh').click();
    await expect(appPage.getByTestId('codebuddy-model-select')).toBeVisible();

    const selector = appPage.getByTestId('codebuddy-model-select');
    await expect(selector).toContainText('qwen-e2e:32b');
    await selector.selectOption('qwen-e2e:32b');
    await expect(selector).toHaveValue('qwen-e2e:32b');
    await appPage.getByTestId('codebuddy-save').click();
    await expect(appPage.getByText('Configuration saved!')).toBeVisible();
    expect(modelServer.requests).toContain('GET /api/health');
    expect(modelServer.requests).toContain('GET /v1/models');
    expect(modelServer.requests).toContain('GET /api/metrics');
  } finally {
    await modelServer.close();
  }
});

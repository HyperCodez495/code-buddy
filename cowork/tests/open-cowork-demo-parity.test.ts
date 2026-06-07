import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const coworkRoot = process.cwd();
const repoRoot = path.resolve(coworkRoot, '..');

const demoVideos = [
  {
    heading: 'Folder Organization & Cleanup',
    url: 'https://github.com/user-attachments/assets/dbeb0337-2d19-4b5d-a438-5220f2a87ca7',
  },
  {
    heading: 'Generate PPT from Files',
    url: 'https://github.com/user-attachments/assets/30299ded-0260-468f-b11d-d282bb9c97f2',
  },
  {
    heading: 'Generate XLSX Spreadsheets',
    url: 'https://github.com/user-attachments/assets/f57b9106-4b2c-4747-aecd-a07f78af5dfc',
  },
  {
    heading: 'GUI Operation',
    url: 'https://github.com/user-attachments/assets/75542c76-210f-414d-8182-1da988c148f2',
  },
  {
    heading: 'Remote control with Feishu',
    url: 'https://github.com/user-attachments/assets/05a703de-c0f5-407b-9a43-18b6a172fd74',
  },
];

function readRepoFile(...segments: string[]): string {
  return readFileSync(path.join(repoRoot, ...segments), 'utf8');
}

describe('Open Cowork demo parity', () => {
  it('keeps every public demo video listed with an explicit media privacy note', () => {
    const readme = readRepoFile('cowork', 'readme.md');

    for (const video of demoVideos) {
      expect(readme).toContain(video.heading);
      expect(readme).toContain(video.url);
    }

    expect(readme).toContain('Public media review');
    expect(readme).toContain('access tokens');
    expect(readme).toContain('OAuth callback URLs');
    expect(readme).toContain('workspace-organizer');
  });

  it('documents screenshots and videos under the same public-review policy', () => {
    const coworkDoc = readRepoFile('docs', 'cowork.md');

    expect(coworkDoc).toContain('Screenshot And Video Privacy Policy');
    expect(coworkDoc).toContain('screenshots and videos');
    expect(coworkDoc).toContain('GitHub user-attachments demo videos');
    expect(coworkDoc).toContain('OAuth callback URLs');
    expect(coworkDoc).toContain('GUI operation / computer-use demonstration');
  });

  it('exposes a runnable Test Runner bundle for the five demo capabilities', () => {
    const source = readRepoFile('cowork', 'src', 'main', 'testing', 'test-runner-bridge.ts');

    expect(source).toContain('Cowork / Open Cowork demo parity bundle');
    expect(source).toContain('tests/skills-manager-builtin-skills.test.ts');
    expect(source).toContain('tests/file-attachment-helpers.test.ts');
    expect(source).toContain('tests/document-workshop-flow.test.ts');
    expect(source).toContain('tests/permission-dialog-computer-use.test.ts');
    expect(source).toContain('tests/remote-control-panel-claude-layout.test.ts');
  });

  it('ships a built-in workspace organization skill for the cleanup demo', () => {
    const skill = readRepoFile('cowork', '.claude', 'skills', 'workspace-organizer', 'SKILL.md');

    expect(skill).toContain('name: workspace-organizer');
    expect(skill).toContain('Do not delete files by default');
    expect(skill).toContain('organization-manifest.md');
  });
});

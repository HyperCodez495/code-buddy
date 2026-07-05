import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { LicenseCheckTool } from '../../src/tools/license-check-tool.js';
describe('LicenseCheckTool', () => { it('flags non-permissive licenses from node_modules package metadata', async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'license-check-tool-')); await fs.mkdir(path.join(root, 'node_modules', 'good'), { recursive: true }); await fs.mkdir(path.join(root, 'node_modules', 'bad'), { recursive: true }); await fs.writeFile(path.join(root, 'node_modules', 'good', 'package.json'), JSON.stringify({ name: 'good', version: '1.0.0', license: 'MIT' })); await fs.writeFile(path.join(root, 'node_modules', 'bad', 'package.json'), JSON.stringify({ name: 'bad', version: '1.0.0', license: 'GPL-3.0' })); const result = await new LicenseCheckTool().execute({ root }); expect(result.success).toBe(false); expect((result.data as { flagged: Array<{ name: string }> }).flagged[0].name).toBe('bad'); }); });

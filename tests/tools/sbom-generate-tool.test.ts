import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { SbomGenerateTool } from '../../src/tools/sbom-generate-tool.js';
describe('SbomGenerateTool', () => { it('generates minimal sbom from node_modules', async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sbom-generate-tool-')); await fs.mkdir(path.join(root, 'node_modules', '@scope', 'pkg'), { recursive: true }); await fs.writeFile(path.join(root, 'node_modules', '@scope', 'pkg', 'package.json'), JSON.stringify({ name: '@scope/pkg', version: '2.0.0', license: 'Apache-2.0' })); const result = await new SbomGenerateTool().execute({ root }); expect(result.success).toBe(true); expect((result.data as { packages: Array<{ name: string }> }).packages[0].name).toBe('@scope/pkg'); }); });

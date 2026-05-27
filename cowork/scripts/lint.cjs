const { spawnSync } = require('node:child_process');
const path = require('node:path');

process.env.ESLINT_USE_FLAT_CONFIG = 'false';

const eslintBin = path.join(
  __dirname,
  '..',
  'node_modules',
  'eslint',
  'bin',
  'eslint.js'
);
const args = process.argv.slice(2);
const finalArgs = args.length > 0 ? args : ['src', '--ext', '.ts,.tsx'];
const result = spawnSync(process.execPath, [eslintBin, ...finalArgs], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);

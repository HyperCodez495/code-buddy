import { describe, it, expect } from 'vitest';
import { detectKind, simpleHash, inferTitle } from '../renderer/utils/artifact-detector';
import {
  detectReactComponent,
  stripModuleSyntax,
  buildReactPreviewDoc,
} from '../renderer/utils/react-preview';

describe('detectKind — which code blocks get an "open as artifact" button', () => {
  it('maps fenced languages to a previewable kind', () => {
    expect(detectKind('html', '<div>x</div>')).toBe('html');
    expect(detectKind('svg', '<svg></svg>')).toBe('svg');
    expect(detectKind('mermaid', 'graph TD; A-->B')).toBe('mermaid');
    expect(detectKind('jsx', 'const X = () => <div/>;')).toBe('react');
    expect(detectKind('tsx', 'export const X = () => null;')).toBe('react');
    expect(detectKind('json', '{"a":1}')).toBe('json');
  });

  it('sniffs the content when there is no language tag', () => {
    expect(detectKind('', '<!doctype html><html></html>')).toBe('html');
    expect(detectKind('', '<svg width="10"></svg>')).toBe('svg');
    expect(detectKind('', 'graph TD\n  A-->B')).toBe('mermaid');
  });

  it('returns null for non-previewable code (→ no artifact button, just copy)', () => {
    expect(detectKind('ts', 'const a = 1;')).toBeNull();
    expect(detectKind('python', 'print(1)')).toBeNull();
    expect(detectKind('bash', 'ls -la')).toBeNull();
    expect(detectKind('', 'just some prose')).toBeNull();
  });
});

describe('simpleHash — stable artifact ids', () => {
  it('is deterministic, prefixed, and collision-distinct', () => {
    expect(simpleHash('html:<div/>')).toBe(simpleHash('html:<div/>'));
    expect(simpleHash('a')).toMatch(/^art_/);
    expect(simpleHash('a')).not.toBe(simpleHash('b'));
  });
});

describe('inferTitle', () => {
  it('pulls a title from html and a component name from react', () => {
    expect(inferTitle('html', '<html><head><title>Hello</title></head></html>')).toBe('Hello');
    expect(inferTitle('react', 'function MyWidget() { return null; }')).toBe('MyWidget');
  });
});

describe('react-preview harness (live React in the sandboxed iframe)', () => {
  it('detects the component to render', () => {
    expect(detectReactComponent('export default function App() {}')).toBe('App');
    expect(detectReactComponent('const Widget = () => null;')).toBe('Widget');
    expect(detectReactComponent('const x = 1;')).toBeNull();
  });

  it('strips ES module syntax and neutralizes </script>', () => {
    const stripped = stripModuleSyntax("import React from 'react';\nexport default function App() {}");
    expect(stripped).not.toContain('import');
    expect(stripped).not.toContain('export');
    expect(stripped).toContain('function App()');
    expect(stripModuleSyntax('const s = "</script>";')).toContain('<\\/script>');
  });

  it('builds a self-contained doc that loads React + Babel and renders the component', () => {
    const doc = buildReactPreviewDoc('export default function App() { return <div>hi</div>; }');
    expect(doc).toContain('react.production.min.js');
    expect(doc).toContain('@babel/standalone');
    expect(doc).toContain('function App()');
    expect(doc).toContain('const __Comp = App');
    expect(doc).toContain('React.createElement(__Comp)');
  });

  it('falls back to a global App when no named component is found', () => {
    const doc = buildReactPreviewDoc('ReactDOM; const root = 1;');
    expect(doc).toContain('typeof App');
  });
});

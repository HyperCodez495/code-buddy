/**
 * React live-preview harness for the Artifact panel.
 *
 * Builds a self-contained HTML document that loads React / ReactDOM / Babel from
 * CDN (like the mermaid preview), compiles the user's JSX/TSX in a sandboxed
 * iframe, and renders the detected component. ES module syntax is stripped (the
 * globals come from the UMD bundles) and common hooks are injected. Pure +
 * testable — no React/DOM imports here.
 *
 * @module renderer/utils/react-preview
 */

/** The component a react snippet should render: first uppercase function/const/class. */
export function detectReactComponent(source: string): string | null {
  const m = source.match(
    /(?:export\s+default\s+function|export\s+function|function|const|class)\s+([A-Z]\w*)/,
  );
  return m ? m[1] : null;
}

/** Strip ES module syntax (globals come from CDN UMD) + neutralize `</script>`. */
export function stripModuleSyntax(source: string): string {
  return source
    .replace(/^\s*import\s+[^\n;]*;?\s*$/gm, '')
    .replace(/export\s+default\s+/g, '')
    .replace(/export\s+/g, '')
    .replace(/<\/script>/gi, '<\\/script>');
}

export function buildReactPreviewDoc(source: string): string {
  const compName = detectReactComponent(source);
  const code = stripModuleSyntax(source);
  const renderTarget = compName || '(typeof App !== "undefined" ? App : null)';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js"></script>
  <style>
    body { font-family: system-ui, sans-serif; margin: 16px; color: #111; background: #fff; }
    #err { color: #c0392b; white-space: pre-wrap; font-family: ui-monospace, monospace; }
  </style>
</head>
<body>
  <div id="root"></div>
  <pre id="err"></pre>
  <script type="text/babel" data-presets="react,typescript">
    const { useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, Fragment } = React;
    try {
${code}
      const __Comp = ${renderTarget};
      if (!__Comp) throw new Error('No React component found — name it with an uppercase first letter (e.g. function App() { … }).');
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(__Comp));
    } catch (e) {
      document.getElementById('err').textContent = String(e && e.message ? e.message : e);
    }
  </script>
</body>
</html>`;
}

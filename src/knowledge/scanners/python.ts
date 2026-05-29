/**
 * Python Scanner — indent-based scoping
 */

import type { LanguageScanner, ScanResult, SymbolDef, CallSite, InheritanceInfo } from './types.js';
import { COMMON_CALL_BLACKLIST, extractMultiLineParams } from './types.js';

const PY_BLACKLIST = new Set([
  ...COMMON_CALL_BLACKLIST,
  'print', 'len', 'range', 'enumerate', 'zip', 'map', 'filter', 'sorted',
  'reversed', 'list', 'dict', 'set', 'tuple', 'str', 'int', 'float', 'bool',
  'type', 'isinstance', 'issubclass', 'hasattr', 'getattr', 'setattr', 'delattr',
  'open', 'super', 'property', 'staticmethod', 'classmethod', 'abs', 'all', 'any',
  'min', 'max', 'sum', 'round', 'repr', 'hash', 'id', 'input', 'iter', 'next',
  'format', 'vars', 'dir', 'globals', 'locals', 'callable', 'chr', 'ord',
  'pytest', 'unittest',
]);

const RE_PY_SELF_CALL = /self\.(\w+)\s*\(/g;
const RE_PY_CLS_CALL = /([A-Z]\w+)\.(\w+)\s*\(/g;
const RE_PY_CALL = /(?:^|[^.\w])(\w+)\s*\(/g;

function indentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  const leading = match?.[1];
  if (leading === undefined) return 0;
  // Normalize: tab = 4 spaces
  return leading.replace(/\t/g, '    ').length;
}

export class PythonScanner implements LanguageScanner {
  readonly extensions = ['.py', '.pyw'];
  readonly language = 'Python';

  scanFile(content: string, moduleId: string): ScanResult {
    const symbols: SymbolDef[] = [];
    const calls: CallSite[] = [];
    const inheritance: InheritanceInfo[] = [];

    const lines = content.split('\n');

    let currentClassName: string | null = null;
    let classIndent = -1;
    let currentFunctionFqn: string | null = null;
    let funcIndent = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const lineNum = i + 1;
      const trimmed = line.trimStart();

      // Skip blank lines and comments for scope detection
      if (trimmed === '' || trimmed.startsWith('#')) {
        // Still extract calls if inside a function
        if (currentFunctionFqn && trimmed.startsWith('#')) continue;
        if (trimmed === '') continue;
      }

      const indent = indentLevel(line);

      // Exit class scope
      if (currentClassName && indent <= classIndent && trimmed !== '' && !trimmed.startsWith('#') && !trimmed.startsWith('"""') && !trimmed.startsWith("'''")) {
        currentClassName = null;
        classIndent = -1;
        // Also exit function scope if it was inside the class
        if (currentFunctionFqn) {
          currentFunctionFqn = null;
          funcIndent = -1;
        }
      }

      // Exit function scope
      if (currentFunctionFqn && indent <= funcIndent && trimmed !== '' && !trimmed.startsWith('#') && !trimmed.startsWith('"""') && !trimmed.startsWith("'''")) {
        currentFunctionFqn = null;
        funcIndent = -1;
      }

      // Class declaration: class Foo(Bar, Baz):
      const classMatch = trimmed.match(/^class\s+(\w+)(?:\(([^)]*)\))?\s*:/);
      if (classMatch) {
        const className = classMatch[1] ?? '';
        const baseList = classMatch[2];
        currentClassName = className;
        classIndent = indent;
        symbols.push({
          fqn: `cls:${className}`,
          name: className,
          kind: 'class',
          module: moduleId,
          line: lineNum,
        });

        // Inheritance
        if (baseList) {
          const bases = baseList.split(',').map(s => s.trim().replace(/\[.*\]$/, '')).filter(s => s && /^[A-Z]/.test(s));
          if (bases.length > 0) {
            const info: InheritanceInfo = { className };
            // First non-protocol base is extends, rest are implements
            const protocols = new Set(['Protocol', 'ABC', 'ABCMeta', 'Generic', 'TypedDict']);
            const realBases = bases.filter(b => !protocols.has(b));
            const ifaceBases = bases.filter(b => protocols.has(b));
            if (realBases.length > 0 && realBases[0] !== undefined) info.extends = realBases[0];
            if (realBases.length > 1 || ifaceBases.length > 0) {
              info.implements = [...realBases.slice(1), ...ifaceBases];
            }
            inheritance.push(info);
          }
        }
        continue;
      }

      // Function/method: def foo(args) -> ReturnType:  or  async def foo(...):
      const funcMatch = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?\s*:/);
      if (funcMatch) {
        const funcName = funcMatch[1] ?? '';
        const rawParams = funcMatch[2]?.trim() || '';
        const rawReturn = funcMatch[3]?.trim() || '';

        // Strip 'self' and 'cls' from params for cleaner display
        const cleanParams = rawParams
          .split(',')
          .map(p => p.trim())
          .filter(p => p !== 'self' && p !== 'cls')
          .join(', ');

        if (currentClassName && indent > classIndent) {
          // Method
          if (funcName === '__init__' || funcName.startsWith('__')) {
            // Still register __init__ as a method but skip dunder as call targets
            if (funcName === '__init__') {
              const fqn = `fn:${currentClassName}.__init__`;
              symbols.push({
                fqn,
                name: '__init__',
                kind: 'method',
                module: moduleId,
                className: currentClassName,
                line: lineNum,
                params: cleanParams ? `(${cleanParams})` : '()',
                returnType: rawReturn || undefined,
              });
              currentFunctionFqn = fqn;
              funcIndent = indent;
            }
          } else {
            const fqn = `fn:${currentClassName}.${funcName}`;
            symbols.push({
              fqn,
              name: funcName,
              kind: 'method',
              module: moduleId,
              className: currentClassName,
              line: lineNum,
              params: cleanParams ? `(${cleanParams})` : '()',
              returnType: rawReturn || undefined,
            });
            currentFunctionFqn = fqn;
            funcIndent = indent;
          }
        } else {
          // Top-level function
          const fqn = `fn:${funcName}`;
          symbols.push({
            fqn,
            name: funcName,
            kind: 'function',
            module: moduleId,
            line: lineNum,
            params: cleanParams ? `(${cleanParams})` : '()',
            returnType: rawReturn || undefined,
          });
          currentFunctionFqn = fqn;
          funcIndent = indent;
        }
        continue;
      }

      // Multi-line function def (params don't close on same line)
      const simpleFuncMatch = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(/);
      if (simpleFuncMatch) {
        const funcName = simpleFuncMatch[1] ?? '';
        const multiParams = extractMultiLineParams(lines, i);
        // Look for return type after closing paren
        let rawReturn: string | undefined;
        for (let j = i; j < Math.min(i + 15, lines.length); j++) {
          const retLine = lines[j];
          if (retLine === undefined) continue;
          const retMatch = retLine.match(/\)\s*->\s*([^:]+):/);
          if (retMatch) { rawReturn = retMatch[1]?.trim(); break; }
        }

        const cleanParams = multiParams
          ? multiParams.slice(1, -1).split(',').map(p => p.trim()).filter(p => p !== 'self' && p !== 'cls').join(', ')
          : '';

        if (currentClassName && indent > classIndent) {
          if (funcName !== '__init__' && !funcName.startsWith('__')) {
            const fqn = `fn:${currentClassName}.${funcName}`;
            symbols.push({
              fqn, name: funcName, kind: 'method', module: moduleId,
              className: currentClassName, line: lineNum,
              params: cleanParams ? `(${cleanParams})` : '()',
              returnType: rawReturn,
            });
            currentFunctionFqn = fqn;
            funcIndent = indent;
          } else if (funcName === '__init__') {
            const fqn = `fn:${currentClassName}.__init__`;
            symbols.push({
              fqn, name: '__init__', kind: 'method', module: moduleId,
              className: currentClassName, line: lineNum,
              params: cleanParams ? `(${cleanParams})` : '()',
              returnType: rawReturn,
            });
            currentFunctionFqn = fqn;
            funcIndent = indent;
          }
        } else {
          const fqn = `fn:${funcName}`;
          symbols.push({
            fqn, name: funcName, kind: 'function', module: moduleId, line: lineNum,
            params: cleanParams ? `(${cleanParams})` : '()',
            returnType: rawReturn,
          });
          currentFunctionFqn = fqn;
          funcIndent = indent;
        }
        continue;
      }

      // Call sites (inside function body)
      if (currentFunctionFqn && indent > funcIndent) {
        if (trimmed.startsWith('#')) continue;

        RE_PY_SELF_CALL.lastIndex = 0;
        let cm: RegExpExecArray | null;
        while ((cm = RE_PY_SELF_CALL.exec(line)) !== null) {
          const calleeName = cm[1];
          if (calleeName === undefined) continue;
          if (!PY_BLACKLIST.has(calleeName) && !calleeName.startsWith('_')) {
            calls.push({
              callerFqn: currentFunctionFqn,
              calleeName,
              isMethodCall: true,
              receiverClass: currentClassName ?? undefined,
            });
          }
        }

        RE_PY_CLS_CALL.lastIndex = 0;
        while ((cm = RE_PY_CLS_CALL.exec(line)) !== null) {
          const receiverClass = cm[1];
          const calleeName = cm[2];
          if (receiverClass === undefined || calleeName === undefined) continue;
          if (!PY_BLACKLIST.has(calleeName) && !PY_BLACKLIST.has(receiverClass)) {
            calls.push({
              callerFqn: currentFunctionFqn,
              calleeName,
              isMethodCall: true,
              receiverClass,
            });
          }
        }

        RE_PY_CALL.lastIndex = 0;
        while ((cm = RE_PY_CALL.exec(line)) !== null) {
          const name = cm[1];
          if (name === undefined) continue;
          if (!PY_BLACKLIST.has(name) && /^[a-z]/.test(name) && name.length > 2) {
            calls.push({
              callerFqn: currentFunctionFqn,
              calleeName: name,
              isMethodCall: false,
            });
          }
        }
      }
    }

    return { symbols, calls, inheritance };
  }
}

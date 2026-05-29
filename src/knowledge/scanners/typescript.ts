/**
 * TypeScript / JavaScript Scanner
 */

import type { LanguageScanner, ScanResult, SymbolDef, CallSite, InheritanceInfo } from './types.js';
import { COMMON_CALL_BLACKLIST, createScopeTracker, updateBraceDepth, extractMultiLineParams, extractReturnTypeAfterParams } from './types.js';

const TS_BLACKLIST = new Set([
  ...COMMON_CALL_BLACKLIST,
  'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number',
  'Boolean', 'Date', 'Promise', 'Map', 'Set', 'RegExp', 'Error',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI',
  'describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach',
  'beforeAll', 'afterAll', 'vi', 'jest',
]);

const RE_THIS_CALL = /this\.(\w+)\s*\(/g;
const RE_STATIC_CALL = /([A-Z]\w+)\.(\w+)\s*\(/g;
const RE_CALL = /(?:^|[^.\w])(\w+)\s*\(/g;

export class TypeScriptScanner implements LanguageScanner {
  readonly extensions = ['.ts', '.tsx', '.js', '.jsx'];
  readonly language = 'TypeScript/JavaScript';

  scanFile(content: string, moduleId: string): ScanResult {
    const symbols: SymbolDef[] = [];
    const calls: CallSite[] = [];
    const inheritance: InheritanceInfo[] = [];

    const tracker = createScopeTracker();
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue; // safe: i < lines.length, guard satisfies noUncheckedIndexedAccess
      const lineNum = i + 1;

      updateBraceDepth(line, tracker);

      // Class declaration
      const classMatch = line.match(/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+(\w+)(?:<[^>]*>)?)?(?:\s+implements\s+([\w,\s<>]+))?/);
      const className = classMatch?.[1];
      if (classMatch && className !== undefined && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*')) {
        const extendsName = classMatch[2];
        const implementsRaw = classMatch[3];
        tracker.currentClassName = className;
        tracker.classStartDepth = tracker.braceDepth - 1;
        symbols.push({
          fqn: `cls:${className}`,
          name: className,
          kind: 'class',
          module: moduleId,
          line: lineNum,
        });
        // Inheritance
        const info: InheritanceInfo = { className };
        if (extendsName) info.extends = extendsName;
        if (implementsRaw) {
          info.implements = implementsRaw.split(',').map(s => s.trim().replace(/<.*>$/, '')).filter(s => s && /^[A-Z]/.test(s));
        }
        if (info.extends || info.implements?.length) inheritance.push(info);
      }

      // Method inside class
      if (tracker.currentClassName) {
        const methodMatch = line.match(/^\s+(?:(?:public|private|protected|static|async|override|readonly|abstract|get|set)\s+)*(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+?))?(?:\s*\{|;)/);
        const methodMatchName = methodMatch?.[1];
        if (methodMatch && methodMatchName !== undefined && !TS_BLACKLIST.has(methodMatchName) && methodMatchName !== 'constructor') {
          const methodName = methodMatchName;
          const fqn = `fn:${tracker.currentClassName}.${methodName}`;
          const rawParams = methodMatch[2]?.trim() || '';
          const rawReturn = methodMatch[3]?.trim() || '';
          symbols.push({
            fqn,
            name: methodName,
            kind: 'method',
            module: moduleId,
            className: tracker.currentClassName,
            line: lineNum,
            params: rawParams ? `(${rawParams})` : '()',
            returnType: rawReturn || undefined,
          });
          tracker.currentFunctionFqn = fqn;
          tracker.funcStartDepth = tracker.braceDepth - 1;
        }
        // Fallback: multi-line params
        if (!methodMatch) {
          const simpleMethodMatch = line.match(/^\s+(?:(?:public|private|protected|static|async|override|readonly|abstract|get|set)\s+)*(\w+)\s*(?:<[^>]*>)?\s*\(/);
          const simpleMethodName = simpleMethodMatch?.[1];
          if (simpleMethodMatch && simpleMethodName !== undefined && !TS_BLACKLIST.has(simpleMethodName) && simpleMethodName !== 'constructor') {
            const methodName = simpleMethodName;
            const fqn = `fn:${tracker.currentClassName}.${methodName}`;
            const multiParams = extractMultiLineParams(lines, i);
            symbols.push({
              fqn,
              name: methodName,
              kind: 'method',
              module: moduleId,
              className: tracker.currentClassName,
              line: lineNum,
              params: multiParams || '(...)',
              returnType: extractReturnTypeAfterParams(lines, i),
            });
            tracker.currentFunctionFqn = fqn;
            tracker.funcStartDepth = tracker.braceDepth - 1;
          }
        }
      }

      // Top-level function
      if (!tracker.currentClassName) {
        const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+?))?(?:\s*\{)/);
        const funcMatchName = funcMatch?.[1];
        if (funcMatch && funcMatchName !== undefined) {
          const funcName = funcMatchName;
          const fqn = `fn:${funcName}`;
          const rawParams = funcMatch[2]?.trim() || '';
          const rawReturn = funcMatch[3]?.trim() || '';
          symbols.push({
            fqn,
            name: funcName,
            kind: 'function',
            module: moduleId,
            line: lineNum,
            params: rawParams ? `(${rawParams})` : '()',
            returnType: rawReturn || undefined,
          });
          tracker.currentFunctionFqn = fqn;
          tracker.funcStartDepth = tracker.braceDepth - 1;
        }
        // Fallback for multi-line function params
        if (!funcMatch) {
          const simpleFuncMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(/);
          const simpleFuncName = simpleFuncMatch?.[1];
          if (simpleFuncMatch && simpleFuncName !== undefined) {
            const funcName = simpleFuncName;
            const fqn = `fn:${funcName}`;
            const multiParams = extractMultiLineParams(lines, i);
            symbols.push({
              fqn,
              name: funcName,
              kind: 'function',
              module: moduleId,
              line: lineNum,
              params: multiParams || '(...)',
              returnType: extractReturnTypeAfterParams(lines, i),
            });
            tracker.currentFunctionFqn = fqn;
            tracker.funcStartDepth = tracker.braceDepth - 1;
          }
        }

        // Arrow function export
        const arrowMatch = line.match(/export\s+(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)(?:\s*:\s*([^=>{]+?))?(?:\s*=>)/);
        const arrowMatchName = arrowMatch?.[1];
        if (arrowMatch && arrowMatchName !== undefined) {
          const funcName = arrowMatchName;
          const rawParams = arrowMatch[2]?.trim() || '';
          const rawReturn = arrowMatch[3]?.trim() || '';
          symbols.push({
            fqn: `fn:${funcName}`,
            name: funcName,
            kind: 'function',
            module: moduleId,
            line: lineNum,
            params: rawParams ? `(${rawParams})` : '()',
            returnType: rawReturn || undefined,
          });
        }
        // Fallback arrow: multi-line
        if (!arrowMatch) {
          const simpleArrowMatch = line.match(/export\s+(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
          const simpleArrowName = simpleArrowMatch?.[1];
          if (simpleArrowMatch && simpleArrowName !== undefined) {
            const funcName = simpleArrowName;
            const multiParams = extractMultiLineParams(lines, i);
            symbols.push({
              fqn: `fn:${funcName}`,
              name: funcName,
              kind: 'function',
              module: moduleId,
              line: lineNum,
              params: multiParams || '(...)',
              returnType: extractReturnTypeAfterParams(lines, i),
            });
          }
        }
      }

      // Call sites
      if (tracker.currentFunctionFqn && tracker.braceDepth > (tracker.funcStartDepth >= 0 ? tracker.funcStartDepth : 0)) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

        RE_THIS_CALL.lastIndex = 0;
        let cm: RegExpExecArray | null;
        while ((cm = RE_THIS_CALL.exec(line)) !== null) {
          const calleeName = cm[1];
          if (calleeName !== undefined && !TS_BLACKLIST.has(calleeName)) {
            calls.push({
              callerFqn: tracker.currentFunctionFqn,
              calleeName,
              isMethodCall: true,
              receiverClass: tracker.currentClassName ?? undefined,
            });
          }
        }

        RE_STATIC_CALL.lastIndex = 0;
        while ((cm = RE_STATIC_CALL.exec(line)) !== null) {
          const receiverClass = cm[1];
          const calleeName = cm[2];
          if (
            receiverClass !== undefined &&
            calleeName !== undefined &&
            !TS_BLACKLIST.has(calleeName) &&
            !TS_BLACKLIST.has(receiverClass)
          ) {
            calls.push({
              callerFqn: tracker.currentFunctionFqn,
              calleeName,
              isMethodCall: true,
              receiverClass,
            });
          }
        }

        RE_CALL.lastIndex = 0;
        while ((cm = RE_CALL.exec(line)) !== null) {
          const name = cm[1];
          if (name !== undefined && !TS_BLACKLIST.has(name) && /^[a-z]/.test(name) && name.length > 2) {
            calls.push({
              callerFqn: tracker.currentFunctionFqn,
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

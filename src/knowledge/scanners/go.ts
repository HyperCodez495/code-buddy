/**
 * Go Scanner — brace-based scoping, struct embedding, method receivers
 */

import type { LanguageScanner, ScanResult, SymbolDef, CallSite, InheritanceInfo } from './types.js';
import { COMMON_CALL_BLACKLIST, createScopeTracker, updateBraceDepth, extractMultiLineParams } from './types.js';

const GO_BLACKLIST = new Set([
  ...COMMON_CALL_BLACKLIST,
  'fmt', 'log', 'make', 'len', 'cap', 'append', 'copy', 'close',
  'panic', 'recover', 'print', 'println', 'new', 'error', 'string',
  'byte', 'rune', 'nil', 'true', 'false', 'iota',
  'Sprintf', 'Printf', 'Fprintf', 'Errorf', 'Println', 'Print',
]);

const RE_GO_METHOD_CALL = /(\w+)\.(\w+)\s*\(/g;
const RE_GO_CALL = /(?:^|[^.\w])(\w+)\s*\(/g;

export class GoScanner implements LanguageScanner {
  readonly extensions = ['.go'];
  readonly language = 'Go';

  scanFile(content: string, moduleId: string): ScanResult {
    const symbols: SymbolDef[] = [];
    const calls: CallSite[] = [];
    const inheritance: InheritanceInfo[] = [];

    const tracker = createScopeTracker();
    const lines = content.split('\n');

    // Track struct body for embedded types
    let inStructBody = false;
    let structName: string | null = null;
    let structDepth = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const lineNum = i + 1;
      const trimmed = line.trimStart();

      updateBraceDepth(line, tracker);

      // Exit struct body
      if (inStructBody && tracker.braceDepth <= structDepth) {
        inStructBody = false;
        structName = null;
        structDepth = -1;
      }

      // Struct declaration: type Foo struct {
      const structMatch = trimmed.match(/^type\s+(\w+)\s+struct\s*\{/);
      if (structMatch) {
        const name = structMatch[1];
        if (name === undefined) continue;
        tracker.currentClassName = name;
        tracker.classStartDepth = tracker.braceDepth - 1;
        inStructBody = true;
        structName = name;
        structDepth = tracker.braceDepth - 1;
        symbols.push({
          fqn: `cls:${name}`,
          name,
          kind: 'class',
          module: moduleId,
          line: lineNum,
        });
        continue;
      }

      // Interface declaration: type Foo interface {
      const ifaceMatch = trimmed.match(/^type\s+(\w+)\s+interface\s*\{/);
      if (ifaceMatch) {
        const ifaceName = ifaceMatch[1];
        if (ifaceName === undefined) continue;
        symbols.push({
          fqn: `iface:${ifaceName}`,
          name: ifaceName,
          kind: 'class',
          module: moduleId,
          line: lineNum,
        });
        continue;
      }

      // Struct embedding (bare type name inside struct body) → extends
      if (inStructBody && structName && tracker.braceDepth > structDepth) {
        const embedMatch = trimmed.match(/^(\*?)([A-Z]\w+)\s*$/);
        if (embedMatch && embedMatch[2] !== undefined && !trimmed.includes('//')) {
          inheritance.push({
            className: structName,
            extends: embedMatch[2],
          });
          continue;
        }
      }

      // Method with receiver: func (r *Type) Name(params) ReturnType {
      const methodMatch = trimmed.match(/^func\s+\((\w+)\s+\*?(\w+)\)\s+(\w+)\s*\(([^)]*)\)(?:\s*(?:\(([^)]*)\)|([^{]*?)))?\s*\{/);
      if (methodMatch) {
        const receiverType = methodMatch[2];
        const methodName = methodMatch[3];
        if (receiverType === undefined || methodName === undefined) continue;
        const rawParams = methodMatch[4]?.trim() || '';
        const rawReturn = (methodMatch[5] || methodMatch[6] || '').trim();
        const fqn = `fn:${receiverType}.${methodName}`;

        symbols.push({
          fqn,
          name: methodName,
          kind: 'method',
          module: moduleId,
          className: receiverType,
          line: lineNum,
          params: rawParams ? `(${rawParams})` : '()',
          returnType: rawReturn || undefined,
        });
        tracker.currentFunctionFqn = fqn;
        tracker.currentClassName = receiverType;
        tracker.funcStartDepth = tracker.braceDepth - 1;
        continue;
      }

      // Method with receiver (multi-line params)
      const simpleMethodMatch = trimmed.match(/^func\s+\((\w+)\s+\*?(\w+)\)\s+(\w+)\s*\(/);
      if (simpleMethodMatch && !methodMatch) {
        const receiverType = simpleMethodMatch[2];
        const methodName = simpleMethodMatch[3];
        if (receiverType === undefined || methodName === undefined) continue;
        const multiParams = extractMultiLineParams(lines, i);
        const fqn = `fn:${receiverType}.${methodName}`;
        symbols.push({
          fqn, name: methodName, kind: 'method', module: moduleId,
          className: receiverType, line: lineNum,
          params: multiParams || '(...)',
        });
        tracker.currentFunctionFqn = fqn;
        tracker.currentClassName = receiverType;
        tracker.funcStartDepth = tracker.braceDepth - 1;
        continue;
      }

      // Top-level function: func Foo(params) ReturnType {
      const funcMatch = trimmed.match(/^func\s+(\w+)\s*\(([^)]*)\)(?:\s*(?:\(([^)]*)\)|([^{]*?)))?\s*\{/);
      if (funcMatch) {
        const funcName = funcMatch[1];
        if (funcName === undefined) continue;
        const rawParams = funcMatch[2]?.trim() || '';
        const rawReturn = (funcMatch[3] || funcMatch[4] || '').trim();
        const fqn = `fn:${funcName}`;
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
        continue;
      }

      // Top-level function (multi-line params)
      const simpleFuncMatch = trimmed.match(/^func\s+(\w+)\s*\(/);
      if (simpleFuncMatch && !funcMatch && !simpleMethodMatch) {
        const funcName = simpleFuncMatch[1];
        if (funcName === undefined) continue;
        const multiParams = extractMultiLineParams(lines, i);
        const fqn = `fn:${funcName}`;
        symbols.push({
          fqn, name: funcName, kind: 'function', module: moduleId, line: lineNum,
          params: multiParams || '(...)',
        });
        tracker.currentFunctionFqn = fqn;
        tracker.funcStartDepth = tracker.braceDepth - 1;
        continue;
      }

      // Call sites
      if (tracker.currentFunctionFqn && tracker.braceDepth > (tracker.funcStartDepth >= 0 ? tracker.funcStartDepth : 0)) {
        if (trimmed.startsWith('//')) continue;

        RE_GO_METHOD_CALL.lastIndex = 0;
        let cm: RegExpExecArray | null;
        while ((cm = RE_GO_METHOD_CALL.exec(line)) !== null) {
          const receiver = cm[1];
          const callee = cm[2];
          if (receiver === undefined || callee === undefined) continue;
          if (!GO_BLACKLIST.has(callee) && !GO_BLACKLIST.has(receiver)) {
            calls.push({
              callerFqn: tracker.currentFunctionFqn,
              calleeName: callee,
              isMethodCall: true,
              receiverClass: /^[A-Z]/.test(receiver) ? receiver : tracker.currentClassName ?? undefined,
            });
          }
        }

        RE_GO_CALL.lastIndex = 0;
        while ((cm = RE_GO_CALL.exec(line)) !== null) {
          const name = cm[1];
          if (name === undefined) continue;
          if (!GO_BLACKLIST.has(name) && name.length > 2) {
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

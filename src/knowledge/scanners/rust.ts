/**
 * Rust Scanner — brace-based scoping, impl blocks, traits
 */

import type { LanguageScanner, ScanResult, SymbolDef, CallSite, InheritanceInfo } from './types.js';
import { COMMON_CALL_BLACKLIST, createScopeTracker, updateBraceDepth, extractMultiLineParams } from './types.js';

const RUST_BLACKLIST = new Set([
  ...COMMON_CALL_BLACKLIST,
  'println', 'eprintln', 'format', 'write', 'writeln', 'vec',
  'Box', 'Rc', 'Arc', 'Some', 'None', 'Ok', 'Err',
  'todo', 'unimplemented', 'unreachable', 'panic', 'assert',
  'assert_eq', 'assert_ne', 'dbg', 'cfg', 'include', 'include_str',
  'match', 'loop', 'break', 'continue', 'move', 'ref', 'mut',
  'unsafe', 'async', 'mod', 'use', 'pub', 'crate', 'self',
]);

const RE_RUST_SELF_CALL = /self\.(\w+)\s*\(/g;
const RE_RUST_STATIC_CALL = /(\w+)::(\w+)\s*\(/g;
const RE_RUST_CALL = /(?:^|[^.\w:])(\w+)\s*\(/g;

export class RustScanner implements LanguageScanner {
  readonly extensions = ['.rs'];
  readonly language = 'Rust';

  scanFile(content: string, moduleId: string): ScanResult {
    const symbols: SymbolDef[] = [];
    const calls: CallSite[] = [];
    const inheritance: InheritanceInfo[] = [];

    const tracker = createScopeTracker();
    tracker.currentImplTarget = null;
    tracker.currentImplTrait = null;
    tracker.implStartDepth = -1;

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const lineNum = i + 1;
      const trimmed = line.trimStart();

      updateBraceDepth(line, tracker);

      // Struct: pub struct Foo {  or  struct Foo {
      const structMatch = trimmed.match(/^(?:pub(?:\(crate\))?\s+)?struct\s+(\w+)(?:<[^>]*>)?(?:\s*\{|\s*\(|\s*;)/);
      if (structMatch?.[1]) {
        const structName = structMatch[1];
        symbols.push({
          fqn: `cls:${structName}`,
          name: structName,
          kind: 'class',
          module: moduleId,
          line: lineNum,
        });
        continue;
      }

      // Enum: pub enum Foo {
      const enumMatch = trimmed.match(/^(?:pub(?:\(crate\))?\s+)?enum\s+(\w+)(?:<[^>]*>)?\s*\{/);
      if (enumMatch?.[1]) {
        const enumName = enumMatch[1];
        symbols.push({
          fqn: `cls:${enumName}`,
          name: enumName,
          kind: 'class',
          module: moduleId,
          line: lineNum,
        });
        continue;
      }

      // Trait: pub trait Foo: SuperTrait {  or  trait Foo {
      const traitMatch = trimmed.match(/^(?:pub(?:\(crate\))?\s+)?trait\s+(\w+)(?:<[^>]*>)?(?:\s*:\s*([\w\s+<>,]+))?\s*\{/);
      if (traitMatch?.[1]) {
        const traitName = traitMatch[1];
        symbols.push({
          fqn: `iface:${traitName}`,
          name: traitName,
          kind: 'class',
          module: moduleId,
          line: lineNum,
        });
        // Trait inheritance
        const superSpec = traitMatch[2];
        if (superSpec) {
          const superTraits = superSpec.split('+').map(s => s.trim().replace(/<.*>$/, '')).filter(s => s && /^[A-Z]/.test(s));
          for (const sup of superTraits) {
            inheritance.push({ className: traitName, extends: sup });
          }
        }
        continue;
      }

      // Impl block: impl Foo {  or  impl Trait for Foo {
      const implMatch = trimmed.match(/^impl(?:<[^>]*>)?\s+(?:(\w+)(?:<[^>]*>)?\s+for\s+)?(\w+)(?:<[^>]*>)?\s*\{/);
      if (implMatch?.[2]) {
        const traitName = implMatch[1] || null;
        const targetName = implMatch[2];
        tracker.currentImplTarget = targetName;
        tracker.currentImplTrait = traitName;
        tracker.implStartDepth = tracker.braceDepth - 1;
        tracker.currentClassName = targetName;
        tracker.classStartDepth = tracker.braceDepth - 1;

        // impl Trait for Struct → implements
        if (traitName) {
          inheritance.push({
            className: targetName,
            implements: [traitName],
          });
        }
        continue;
      }

      // Function/method: fn name(params) -> ReturnType {
      const fnMatch = trimmed.match(/^(?:pub(?:\(crate\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*([^{]+))?\s*\{/);
      if (fnMatch?.[1]) {
        const funcName = fnMatch[1];
        const rawParams = fnMatch[2]?.trim() || '';
        const rawReturn = fnMatch[3]?.trim() || '';

        // Check if it's a method (inside impl block)
        if (tracker.currentImplTarget && tracker.braceDepth > (tracker.implStartDepth ?? -1)) {
          const fqn = `fn:${tracker.currentImplTarget}.${funcName}`;
          // Clean params: remove &self, &mut self, self
          const cleanParams = rawParams
            .split(',')
            .map(p => p.trim())
            .filter(p => p !== '&self' && p !== '&mut self' && p !== 'self' && p !== 'mut self')
            .join(', ');
          symbols.push({
            fqn,
            name: funcName,
            kind: 'method',
            module: moduleId,
            className: tracker.currentImplTarget,
            line: lineNum,
            params: cleanParams ? `(${cleanParams})` : '()',
            returnType: rawReturn || undefined,
          });
          tracker.currentFunctionFqn = fqn;
          tracker.funcStartDepth = tracker.braceDepth - 1;
        } else {
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
        }
        continue;
      }

      // Fallback: multi-line fn params
      const simpleFnMatch = trimmed.match(/^(?:pub(?:\(crate\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)(?:<[^>]*>)?\s*\(/);
      if (simpleFnMatch?.[1] && !fnMatch) {
        const funcName = simpleFnMatch[1];
        const multiParams = extractMultiLineParams(lines, i);
        // Look for return type
        let rawReturn: string | undefined;
        for (let j = i; j < Math.min(i + 15, lines.length); j++) {
          const retLine = lines[j];
          const retMatch = retLine?.match(/\)\s*->\s*([^{]+?)\s*\{/);
          if (retMatch?.[1]) { rawReturn = retMatch[1].trim(); break; }
        }

        if (tracker.currentImplTarget && tracker.braceDepth > (tracker.implStartDepth ?? -1)) {
          const fqn = `fn:${tracker.currentImplTarget}.${funcName}`;
          symbols.push({
            fqn, name: funcName, kind: 'method', module: moduleId,
            className: tracker.currentImplTarget, line: lineNum,
            params: multiParams || '(...)', returnType: rawReturn,
          });
          tracker.currentFunctionFqn = fqn;
        } else {
          const fqn = `fn:${funcName}`;
          symbols.push({
            fqn, name: funcName, kind: 'function', module: moduleId, line: lineNum,
            params: multiParams || '(...)', returnType: rawReturn,
          });
          tracker.currentFunctionFqn = fqn;
        }
        tracker.funcStartDepth = tracker.braceDepth - 1;
        continue;
      }

      // Call sites
      if (tracker.currentFunctionFqn && tracker.braceDepth > (tracker.funcStartDepth >= 0 ? tracker.funcStartDepth : 0)) {
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

        RE_RUST_SELF_CALL.lastIndex = 0;
        let cm: RegExpExecArray | null;
        while ((cm = RE_RUST_SELF_CALL.exec(line)) !== null) {
          const selfCallee = cm[1];
          if (selfCallee && !RUST_BLACKLIST.has(selfCallee)) {
            calls.push({
              callerFqn: tracker.currentFunctionFqn,
              calleeName: selfCallee,
              isMethodCall: true,
              receiverClass: tracker.currentImplTarget ?? undefined,
            });
          }
        }

        RE_RUST_STATIC_CALL.lastIndex = 0;
        while ((cm = RE_RUST_STATIC_CALL.exec(line)) !== null) {
          const staticReceiver = cm[1];
          const staticCallee = cm[2];
          if (staticReceiver && staticCallee && !RUST_BLACKLIST.has(staticCallee) && !RUST_BLACKLIST.has(staticReceiver)) {
            calls.push({
              callerFqn: tracker.currentFunctionFqn,
              calleeName: staticCallee,
              isMethodCall: true,
              receiverClass: staticReceiver,
            });
          }
        }

        RE_RUST_CALL.lastIndex = 0;
        while ((cm = RE_RUST_CALL.exec(line)) !== null) {
          const name = cm[1];
          if (name && !RUST_BLACKLIST.has(name) && name.length > 2) {
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

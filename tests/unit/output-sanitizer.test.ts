import { describe, it, expect } from 'vitest';
import { sanitizeModelOutput, stripInvisibleChars } from '@/utils/output-sanitizer.js';
import { sanitizeLLMOutput } from '@/utils/sanitize.js';

describe('output-sanitizer', () => {
  describe('sanitizeModelOutput', () => {
    it('returns empty string for falsy input', () => {
      expect(sanitizeModelOutput('')).toBe('');
      expect(sanitizeModelOutput(null as unknown as string)).toBe('');
      expect(sanitizeModelOutput(undefined as unknown as string)).toBe('');
    });

    it('returns content unchanged when no patterns match', () => {
      const text = 'Hello, this is a normal response with **markdown** and `code`.';
      expect(sanitizeModelOutput(text)).toBe(text);
    });

    // --- GLM-5 full-width tokens ---
    describe('GLM-5 full-width tokens', () => {
      it('strips full-width angle bracket tokens', () => {
        // \uFF1C = ＜  \uFF5C = ｜  \uFF1E = ＞
        const input = '\uFF1C\uFF5Cassistant\uFF5C\uFF1EHello there';
        expect(sanitizeModelOutput(input)).toBe('Hello there');
      });

      it('strips multiple GLM-5 tokens', () => {
        const input = '\uFF1C\uFF5Cuser\uFF5C\uFF1EHi\uFF1C\uFF5Cassistant\uFF5C\uFF1E world';
        expect(sanitizeModelOutput(input)).toBe('Hi world');
      });

      it('strips GLM-5 tokens with varied content', () => {
        const input = 'prefix\uFF1C\uFF5Csome_token\uFF5C\uFF1Esuffix';
        expect(sanitizeModelOutput(input)).toBe('prefixsuffix');
      });
    });

    // --- DeepSeek thinking/reasoning blocks ---
    describe('DeepSeek think/reasoning blocks', () => {
      it('strips <think>...</think> blocks', () => {
        const input = '<think>I should analyze the code first.\nLet me check imports.</think>Here is the answer.';
        expect(sanitizeModelOutput(input)).toBe('Here is the answer.');
      });

      it('strips <reasoning>...</reasoning> blocks', () => {
        const input = '<reasoning>Step 1: Read the file.\nStep 2: Edit it.</reasoning>Done!';
        expect(sanitizeModelOutput(input)).toBe('Done!');
      });

      it('strips multiline think blocks', () => {
        const input = 'Before<think>\nLine 1\nLine 2\nLine 3\n</think>After';
        expect(sanitizeModelOutput(input)).toBe('BeforeAfter');
      });

      it('strips multiple think blocks', () => {
        const input = '<think>first</think>middle<think>second</think>end';
        expect(sanitizeModelOutput(input)).toBe('middleend');
      });
    });

    // --- ChatML markers ---
    describe('ChatML markers', () => {
      it('strips <|im_start|> and <|im_end|>', () => {
        const input = '<|im_start|>assistant\nHello<|im_end|>';
        expect(sanitizeModelOutput(input)).toBe('assistant\nHello');
      });

      it('strips <|endoftext|>', () => {
        const input = 'Response complete.<|endoftext|>';
        expect(sanitizeModelOutput(input)).toBe('Response complete.');
      });

      it('strips <|assistant|>, <|user|>, <|system|>', () => {
        const input = '<|system|>You are helpful.<|user|>Hi<|assistant|>Hello!';
        expect(sanitizeModelOutput(input)).toBe('You are helpful.HiHello!');
      });

      it('strips generic control tokens like <|pad|>, <|eos|>', () => {
        const input = 'text<|pad|><|eos|>more';
        expect(sanitizeModelOutput(input)).toBe('textmore');
      });

      it('strips malformed local channel markers without removing XML-like tags', () => {
        expect(sanitizeModelOutput('thought\n<channel|>42')).toBe('42');
        expect(sanitizeModelOutput('before <|tool_call> after')).toBe('before  after');
        expect(sanitizeModelOutput('<message>legit</message>')).toBe('<message>legit</message>');
      });

      it('strips JSON-escaped control tokens', () => {
        const input = 'before\\u003c|im_start|\\u003eafter';
        expect(sanitizeModelOutput(input)).toBe('beforeafter');
      });
    });

    // --- LLaMA markers ---
    describe('LLaMA markers', () => {
      it('strips [INST]...[/INST] blocks', () => {
        const input = '[INST] What is 2+2? [/INST]The answer is 4.';
        expect(sanitizeModelOutput(input)).toBe('The answer is 4.');
      });

      it('strips multiline [INST] blocks', () => {
        const input = '[INST]\nTell me about TypeScript.\nBe concise.\n[/INST]TypeScript is...';
        expect(sanitizeModelOutput(input)).toBe('TypeScript is...');
      });

      it('strips <<SYS>>...</</SYS>> blocks', () => {
        const input = '<<SYS>>You are a helpful assistant.<</SYS>>Hello!';
        // <<\/SYS>> pattern: the regex uses <<\/SYS>> to match <</SYS>>
        expect(sanitizeModelOutput(input)).toBe('Hello!');
      });

      it('strips multiline <<SYS>> blocks', () => {
        const input = '<<SYS>>\nSystem instructions\nhere\n<</SYS>>Response';
        expect(sanitizeModelOutput(input)).toBe('Response');
      });
    });

    // --- Edge cases ---
    describe('edge cases', () => {
      it('handles content with only control tokens', () => {
        const input = '<|im_start|><|im_end|><|endoftext|>';
        expect(sanitizeModelOutput(input)).toBe('');
      });

      it('collapses excessive newlines left by stripped blocks', () => {
        const input = 'Before\n\n\n<think>thinking</think>\n\n\nAfter';
        const result = sanitizeModelOutput(input);
        expect(result).not.toContain('\n\n\n');
        expect(result).toContain('Before');
        expect(result).toContain('After');
      });

      it('preserves legitimate HTML-like tags', () => {
        // <thinking> in markdown or general HTML tags should NOT be stripped
        const input = 'Use `<thinking>` in your prompt for step-by-step reasoning.';
        expect(sanitizeModelOutput(input)).toBe(input);
      });

      it('preserves legitimate <div> and <span> tags', () => {
        const input = '<div>content</div><span>text</span>';
        expect(sanitizeModelOutput(input)).toBe(input);
      });

      it('handles mixed control tokens from different models', () => {
        const input = '<|im_start|><think>internal</think>[INST]prompt[/INST]Real content';
        expect(sanitizeModelOutput(input)).toBe('Real content');
      });

      it('handles control tokens embedded within normal text', () => {
        const input = 'Start <|assistant|> middle <|im_end|> end';
        expect(sanitizeModelOutput(input)).toBe('Start  middle  end');
      });
    });
  });

  describe('stripInvisibleChars', () => {
    it('returns empty string for falsy input', () => {
      expect(stripInvisibleChars('')).toBe('');
      expect(stripInvisibleChars(null as unknown as string)).toBe('');
      expect(stripInvisibleChars(undefined as unknown as string)).toBe('');
    });

    it('strips zero-width space (U+200B)', () => {
      const input = 'hello\u200Bworld';
      expect(stripInvisibleChars(input)).toBe('helloworld');
    });

    it('strips zero-width non-joiner (U+200C)', () => {
      const input = 'test\u200Cvalue';
      expect(stripInvisibleChars(input)).toBe('testvalue');
    });

    it('strips zero-width joiner (U+200D)', () => {
      const input = 'foo\u200Dbar';
      expect(stripInvisibleChars(input)).toBe('foobar');
    });

    it('strips BOM / zero-width no-break space (U+FEFF)', () => {
      const input = '\uFEFFstart of file';
      expect(stripInvisibleChars(input)).toBe('start of file');
    });

    it('strips soft hyphen (U+00AD)', () => {
      const input = 'hyphen\u00ADated';
      expect(stripInvisibleChars(input)).toBe('hyphenated');
    });

    it('strips multiple different invisible chars', () => {
      const input = '\uFEFF\u200Bhello\u200C\u200D\u00ADworld';
      expect(stripInvisibleChars(input)).toBe('helloworld');
    });

    it('preserves normal whitespace', () => {
      const input = 'hello world\ttab\nnewline';
      expect(stripInvisibleChars(input)).toBe('hello world\ttab\nnewline');
    });

    it('returns unchanged text when no invisible chars present', () => {
      const input = 'Normal text with no invisible characters.';
      expect(stripInvisibleChars(input)).toBe(input);
    });

    it('strips the word joiner (U+2060) and invisible math operators (U+2061..U+2064)', () => {
      expect(stripInvisibleChars('word⁠joiner')).toBe('wordjoiner');
      expect(stripInvisibleChars('a⁡b⁢c⁣d⁤e')).toBe('abcde');
    });

    it('strips the Mongolian vowel separator (U+180E)', () => {
      expect(stripInvisibleChars('x᠎y')).toBe('xy');
    });

    it('PRESERVES an emoji variation selector (U+FE0F) — it changes rendering, not a leak', () => {
      const emoji = '❤️'; // ❤️ (heart + VS-16)
      expect(stripInvisibleChars(`j'aime ${emoji}`)).toBe(`j'aime ${emoji}`);
    });
  });

  describe('sanitizeLLMOutput (integrated)', () => {
    it('applies both model output sanitization and invisible char stripping', () => {
      const input = '<|im_start|>\u200BHello\u200C world<|im_end|>';
      const result = sanitizeLLMOutput(input);
      expect(result).toBe('Hello world');
    });

    it('strips DeepSeek think blocks plus invisible chars', () => {
      const input = '<think>reasoning\u200B</think>\uFEFFThe answer is 42.';
      const result = sanitizeLLMOutput(input);
      expect(result).toBe('The answer is 42.');
    });

    it('strips GLM-5 tokens plus commentary patterns', () => {
      const input = '\uFF1C\uFF5Cassistant\uFF5C\uFF1Ecommentary to=web_search {"query":"test"}Result here';
      const result = sanitizeLLMOutput(input);
      expect(result).toBe('Result here');
    });

    it('strips LLaMA [INST] blocks plus zero-width chars', () => {
      const input = '[INST] Be helpful [/INST]\u200BHere is your answer.';
      const result = sanitizeLLMOutput(input);
      expect(result).toBe('Here is your answer.');
    });

    it('preserves legitimate content through the full pipeline', () => {
      const input = 'Here is a code example:\n```python\nprint("hello")\n```\nDone.';
      expect(sanitizeLLMOutput(input)).toBe(input);
    });

    it('handles empty and null input gracefully', () => {
      expect(sanitizeLLMOutput('')).toBe('');
      expect(sanitizeLLMOutput(null as unknown as string)).toBe('');
    });
  });

  describe('agent-executor integration', () => {
    it('sanitizeModelOutput + stripInvisibleChars can be composed for executor use', () => {
      // This test verifies the pattern used in agent-executor.ts:
      // stripInvisibleChars(sanitizeModelOutput(content))
      const content = '<|assistant|>\u200BHello<think>internal</think>\uFEFF world';
      const sanitized = stripInvisibleChars(sanitizeModelOutput(content));
      expect(sanitized).toBe('Hello world');
      // No control tokens, no invisible chars
      expect(sanitized).not.toMatch(/<\|/);
      expect(sanitized).not.toMatch(/<think>/);
      expect(sanitized).not.toContain('\u200B');
      expect(sanitized).not.toContain('\uFEFF');
    });
  });
});

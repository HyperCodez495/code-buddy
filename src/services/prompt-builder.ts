/**
 * Prompt Builder Service
 *
 * Handles the construction of system prompts for the agent,
 * supporting various modes (standard, YOLO, custom) and
 * integrating external Markdown prompts.
 *
 * Moltbot Integration:
 * - Loads intro_hook.txt content and prepends to system prompt
 * - Supports project-level and global intro hooks
 */

import { logger } from "../utils/logger.js";
import { getErrorMessage } from "../errors/index.js";
import {
  getSystemPromptForMode,
  getPromptManager,
  autoSelectPromptId,
} from "../prompts/index.js";
import { EnhancedMemory, PersistentMemoryManager } from "../memory/index.js";
import { PromptCacheManager } from "../optimization/prompt-cache.js";
import { MoltbotHooksManager } from "../hooks/moltbot-hooks.js";
import { getModelToolConfig } from "../config/model-tools.js";

export interface PromptBuilderConfig {
  yoloMode: boolean;
  memoryEnabled: boolean;
  morphEditorEnabled: boolean;
  cwd: string;
}

export class PromptBuilder {
  constructor(
    private config: PromptBuilderConfig,
    private promptCacheManager: PromptCacheManager,
    private memory?: EnhancedMemory,
    private moltbotHooksManager?: MoltbotHooksManager,
    private persistentMemory?: PersistentMemoryManager
  ) {}

  /**
   * Build the system prompt for the agent
   */
  async buildSystemPrompt(
    systemPromptId: string | undefined,
    modelName: string,
    customInstructions: string | null
  ): Promise<string> {
    try {
      let systemPrompt: string;

      // Load Moltbot intro hook content (role/personality instructions)
      let introHookContent: string | undefined;
      if (this.moltbotHooksManager) {
        try {
          const introManager = this.moltbotHooksManager.getIntroManager();
          const introResult = await introManager.loadIntro();
          if (introResult.content) {
            introHookContent = introResult.content;
            logger.debug(`Loaded intro hook from sources: ${introResult.sources.join(', ')}`);
          }
        } catch (err) {
          logger.warn("Failed to load intro hook", { error: getErrorMessage(err) });
        }
      }

      // Get memory context if enabled
      let memoryContext: string | undefined;
      if (this.config.memoryEnabled) {
        let enhancedMemoryContext = "";
        if (this.memory) {
          try {
            enhancedMemoryContext = await this.memory.buildContext({
              includeProject: true,
              includePreferences: true,
              includeRecentSummaries: true
            });
          } catch (err) {
            logger.warn("Failed to build enhanced memory context", { error: getErrorMessage(err) });
          }
        }

        let persistentMemoryContext = "";
        if (this.persistentMemory) {
          try {
            persistentMemoryContext = this.persistentMemory.getContextForPrompt();
          } catch (err) {
            logger.warn("Failed to build persistent memory context", { error: getErrorMessage(err) });
          }
        }

        memoryContext = (enhancedMemoryContext + "\n" + persistentMemoryContext).trim();
        if (!memoryContext) memoryContext = undefined;
      }

      if (systemPromptId && systemPromptId !== 'auto') {
        // Use external prompt system (new)
        const promptManager = getPromptManager();
        systemPrompt = await promptManager.buildSystemPrompt({
          promptId: systemPromptId,
          includeModelInfo: true,
          includeOsInfo: true,
          includeProjectContext: true, // Codex CLI pattern: git state in system prompt
          includeToolPrompts: true,
          userInstructions: customInstructions || undefined,
          cwd: this.config.cwd,
          modelName,
          tools: ['view_file', 'str_replace_editor', 'create_file', 'search', 'bash', 'todo', 'reason'],
          includeMemory: !!memoryContext,
          memoryContext,
        });
        logger.debug(`Using system prompt: ${systemPromptId}`);
      } else if (systemPromptId === 'auto') {
        // Auto-select based on model alignment
        const autoId = autoSelectPromptId(modelName);
        const promptManager = getPromptManager();
        systemPrompt = await promptManager.buildSystemPrompt({
          promptId: autoId,
          includeModelInfo: true,
          includeOsInfo: true,
          userInstructions: customInstructions || undefined,
          cwd: this.config.cwd,
          modelName,
          includeMemory: !!memoryContext,
          memoryContext,
        });
        logger.debug(`Auto-selected prompt: ${autoId} (based on ${modelName})`);
      } else {
        // Use legacy system (current behavior)
        const promptMode = this.config.yoloMode ? "yolo" : "default";
        systemPrompt = getSystemPromptForMode(
          promptMode,
          this.config.morphEditorEnabled,
          this.config.cwd,
          customInstructions || undefined
        );
      }

      // Prepend intro hook content if available (Moltbot-style role injection)
      if (introHookContent) {
        systemPrompt = `# Role & Instructions (from intro_hook.txt)\n\n${introHookContent}\n\n---\n\n${systemPrompt}`;
        logger.debug("Prepended intro hook content to system prompt");
      }

      // Inject bootstrap context files (BOOTSTRAP.md, AGENTS.md, SOUL.md, etc.)
      try {
        const { BootstrapLoader } = await import('../context/bootstrap-loader.js');
        const bootstrap = await new BootstrapLoader().load(this.config.cwd);
        if (bootstrap.content) {
          systemPrompt += '\n\n# Workspace Context\n\n' + bootstrap.content;
          logger.debug(`Loaded bootstrap context from ${bootstrap.sources.length} file(s)`, {
            sources: bootstrap.sources,
            chars: bootstrap.tokenCount,
            truncated: bootstrap.truncated,
          });
        }
      } catch (err) {
        logger.warn("Failed to load bootstrap context", { error: getErrorMessage(err) });
      }

      // Inject active persona instructions
      try {
        const { getPersonaManager } = await import('../personas/persona-manager.js');
        const personaBlock = getPersonaManager().buildSystemPrompt();
        if (personaBlock) {
          systemPrompt += `\n\n<persona>\n${personaBlock}\n</persona>`;
          logger.debug('Injected active persona into system prompt');
        }
      } catch { /* personas module optional */ }

      // Inject knowledge base context
      try {
        const { getKnowledgeManager } = await import('../knowledge/knowledge-manager.js');
        const km = getKnowledgeManager();
        if (!km.isLoaded) {
          await km.load();
        }
        const knowledgeBlock = km.buildContextBlock();
        if (knowledgeBlock) {
          systemPrompt += `\n\n<knowledge>\n${knowledgeBlock}\n</knowledge>`;
          logger.debug('Injected knowledge base into system prompt');
        }
      } catch { /* knowledge module optional */ }

      // Inject generated documentation architecture summary
      try {
        const { getDocsContextProvider } = await import('../docs/docs-context-provider.js');
        const docsProvider = getDocsContextProvider();
        if (!docsProvider.isLoaded) {
          await docsProvider.loadDocsIndex();
        }
        const architectureSummary = docsProvider.getArchitectureSummary();
        if (architectureSummary) {
          systemPrompt += `\n\n<project_docs>\n${architectureSummary}\n</project_docs>`;
        }
      } catch { /* docs context module optional */ }

      // Inject modular rules (.codebuddy/rules/)
      try {
        const { getRulesLoader } = await import('../rules/rules-loader.js');
        const rulesLoader = getRulesLoader();
        if (!rulesLoader.isLoaded) {
          await rulesLoader.load();
        }
        const rulesBlock = rulesLoader.buildContextBlock();
        if (rulesBlock) {
          systemPrompt += `\n\n<rules>\n${rulesBlock}\n</rules>`;
          logger.debug('Injected modular rules into system prompt');
        }
      } catch { /* rules module optional */ }

      // Inject active skill prompt enhancement
      try {
        const { getSkillManager } = await import('../skills/index.js');
        const skillManager = getSkillManager();
        const skillBlock = skillManager.getSkillPromptEnhancement();
        if (skillBlock) {
          systemPrompt += `\n\n${skillBlock}`;
          logger.debug('Injected active skill enhancement into system prompt');
        }
      } catch { /* skills module optional */ }

      // Inject identity (SOUL.md, USER.md, AGENTS.md) — skip if already present to avoid duplication
      try {
        if (!systemPrompt.includes('## SOUL.md') && !systemPrompt.includes('## AGENTS.md')) {
          const { getIdentityManager } = await import('../identity/identity-manager.js');
          const identityMgr = getIdentityManager();
          await identityMgr.load(process.cwd());
          const identityBlock = identityMgr.getPromptInjection();
          if (identityBlock) {
            systemPrompt += `\n\n<identity>\n${identityBlock}\n</identity>`;
            logger.debug('Injected identity into system prompt');
          }
        }
      } catch { /* identity module optional */ }

      // Inject auto-memory directive — tells the LLM WHEN to call the
      // `remember` tool to auto-persist non-obvious facts to
      // .codebuddy/CODEBUDDY_MEMORY.md (project) or ~/.codebuddy/memory.md
      // (user). Without this directive, the tool is registered but the LLM
      // has no instruction on when to use it, so the file stays empty.
      // Paired with `alwaysInclude: ['remember']` in tool-selection-strategy.
      if (this.config.memoryEnabled && this.persistentMemory) {
        systemPrompt += `\n\n<auto_memory_directive>
You have a persistent memory system at .codebuddy/CODEBUDDY_MEMORY.md (project-scoped) and ~/.codebuddy/memory.md (user-scoped, all projects). Use the \`remember\` tool to save facts that will be useful in future sessions.

When to call \`remember\`:
- User preferences ("user prefers single quotes", "always use Vitest, not Jest")
- Architectural decisions ("API uses JWT in HttpOnly cookies, not localStorage")
- Non-obvious gotchas ("vi.hoisted() needed for mock factories in this repo")
- Project-specific conventions or constraints the user just revealed

When NOT to call \`remember\`:
- Things derivable from reading the code, git log, or package.json
- Ephemeral task details (current bug being fixed, in-progress edits)
- Information already covered by an existing memory entry

Format:
- \`key\`: short kebab-case identifier (e.g. \`test-framework\`, \`indent-style\`, \`jwt-storage\`)
- \`value\`: 1-3 sentences, factual, written for future-you in a fresh session
- \`scope\`: \`project\` (default — fact is specific to THIS repo) or \`user\` (preference across all projects)
- \`category\`: \`preferences\`, \`decisions\`, \`patterns\`, \`project\`, or \`custom\`

Call \`remember\` proactively when you learn something worth remembering — don't wait for the user to ask.
</auto_memory_directive>`;
        logger.debug('Injected auto-memory directive into system prompt');

        // Lessons directive — Manus AI-inspired self-improvement loop
        // (`src/agent/lessons-tracker.ts`). The LessonsTracker, lessons_add /
        // lessons_search tools, and per-turn `<lessons_context>` injection
        // were all shipped — but the LLM never proactively called the tools
        // because no system directive told it WHEN. This block fixes that
        // (mirror of the auto-memory directive above).
        systemPrompt += `\n\n<lessons_directive>
Code Buddy maintains a self-improvement loop via the \`lessons_add\` and \`lessons_search\` tools (Manus AI-inspired pattern). Lessons persist to .codebuddy/lessons.md (project-scoped) and ~/.codebuddy/lessons.md (global, all projects). They differ from \`remember\` by capturing actionable patterns rather than facts.

Four categories — pick the right one:
- **RULE**: invariants to follow ("Never commit .env files", "Use vi.hoisted() for mock factories in this repo")
- **PATTERN**: error corrections you observed ("If type X errors with Y, add Z annotation")
- **CONTEXT**: project-specific facts ("The auth module uses JWT in HttpOnly cookies, not localStorage")
- **INSIGHT**: non-obvious observations ("Tests are flaky on Windows due to CRLF line endings; use git config core.autocrlf=input")

When to call \`lessons_add\`:
- After the user corrects your approach — extract the rule/pattern that would have prevented the mistake
- When you discover a project convention or gotcha not derivable from code or git log
- When you find a successful pattern you would re-apply on similar tasks

When to call \`lessons_search\` (BEFORE acting on a related task):
- Before implementing a feature similar to one the user previously corrected
- Before running tests if a previous lesson noted flakiness in the area
- When the task domain matches a category — e.g. before any auth work, search "auth"

What NOT to add:
- Things derivable from code, git log, or package.json
- Ephemeral details (current bug being fixed, in-progress edit)
- Information already covered by an existing lesson — search first, dedupe via the \`id\` field

Lessons complement \`remember\`: \`remember\` stores facts (preferences, decisions); \`lessons_add\` stores actionable patterns and rules. Use whichever fits — both persist across sessions.
</lessons_directive>`;
        logger.debug('Injected lessons directive into system prompt');
      }

      // Inject `<writing_rules>` directive — proactive output discipline.
      // Inspired by Manus AI's structured prompt blocks pattern (gist
      // renschni/4fbc70b... May 2026 reverse-engineering). Pairs with
      // `src/utils/output-sanitizer.ts` (post-hoc strip): the sanitizer
      // is a safety net; this directive instructs the LLM BEFORE
      // generation so wasted tokens are minimized and tone/structure
      // remain consistent.
      //
      // Always-on (no `memoryEnabled` gate) — output discipline is
      // universally useful, even for sessions with no persistent memory.
      systemPrompt += `\n\n<writing_rules>
Output formatting discipline:

- Never emit model control tokens in your output: no \`<|im_start|>\`, \`<|im_end|>\`, \`<think>\`, \`<reasoning>\`, \`[INST]\`, \`<<SYS>>\`, GLM-5 full-width brackets, or any \`<|…|>\` variant. The runtime strips these as a safety net but the cost is wasted tokens.
- No zero-width characters (U+200B, U+200C, U+200D, U+FEFF) or invisible Unicode for "stylistic" effect.
- Use markdown for structure when output is rendered:
  - Code fences with language hint: \`\`\`ts not bare \`\`\`
  - Inline code with backticks for identifiers, paths, commands
  - Tables for tabular comparisons (≥3 rows make a table worth it)
  - Bold/italic sparingly — only when emphasis is load-bearing
- No emoji unless the user explicitly requested them or they convey load-bearing information (e.g. ✅/❌ status markers in a table).
- No meta-commentary about being an AI: skip "As an AI...", "I'll help you with...", "Let me explain...". Just answer.
- Tone: direct, factual, terse. Match the user's register (formal ↔ casual).
- Links: markdown hyperlinks \`[label](url)\`, not raw URLs in flowing text.
- File references: use \`path/to/file.ts:42\` format so the user can navigate by click.
- When uncertain about facts, say "I don't know" rather than fabricating. When uncertain about correctness of code, mark it as untested.
</writing_rules>`;
      logger.debug('Injected writing_rules directive into system prompt');

      // Inject auto-detected coding style conventions
      try {
        const { getCodingStyleAnalyzer } = await import('../memory/coding-style-analyzer.js');
        const analyzer = getCodingStyleAnalyzer();
        const profile = await analyzer.analyzeDirectory(this.config.cwd);
        if (profile) {
          const styleBlock = analyzer.buildPromptSnippet(profile);
          if (styleBlock) {
            systemPrompt += `\n\n${styleBlock}`;
            logger.debug('Injected coding style conventions into system prompt');
          }
        }
      } catch { /* coding-style module optional */ }

      // Inject workflow orchestration rules (concrete plan triggers, verification contract, etc.)
      try {
        const { getWorkflowRulesBlock } = await import('../prompts/workflow-rules.js');
        systemPrompt += '\n\n' + getWorkflowRulesBlock();
        logger.debug('Injected workflow orchestration rules into system prompt');
      } catch (err) {
        logger.warn('Failed to inject workflow rules', { error: getErrorMessage(err) });
      }

      // Manus AI structured variation — shuffle reminder blocks to prevent
      // the model from falling into brittle repetition patterns.
      // Only the footer guideline section is varied; the preamble/tools are left
      // untouched so prompt caching remains effective on the stable prefix.
      try {
        const { varySystemPrompt } = await import('../prompts/variation-injector.js');
        // Use a daily seed so the variation is stable within a single day
        // (same day → same order → consistent cache), but rotates across days.
        const daySeed = Math.floor(Date.now() / 86_400_000);
        systemPrompt = varySystemPrompt(systemPrompt, {
          seed: daySeed,
          shuffleOrder: true,
          alternativePhrasing: true,
          variationRate: 0.3,
        });
      } catch {
        // non-critical — proceed with original prompt
      }

      // Truncate system prompt if it exceeds the model's context budget.
      // Reserve 50% of (contextWindow - maxOutputTokens) for the system prompt;
      // the rest goes to conversation history. Simple head-truncation keeps the
      // most critical instructions (always at the top) intact.
      const toolConfig = getModelToolConfig(modelName);
      const contextWindow = toolConfig.contextWindow ?? 8192;
      const maxOutputTokens = toolConfig.maxOutputTokens ?? 2048;
      const budgetTokens = Math.min(Math.floor((contextWindow - maxOutputTokens) * 0.5), 32_000); // 32K hard cap
      const budgetChars = budgetTokens * 4; // ~4 chars per token
      if (systemPrompt.length > budgetChars) {
        logger.warn(`System prompt truncated for ${modelName}: ${systemPrompt.length} chars → ${budgetChars} (budget: ${budgetTokens} tokens, 32K hard cap)`);
        systemPrompt = systemPrompt.slice(0, budgetChars - 3) + '...';
      }

      // Cache system prompt for optimization
      this.promptCacheManager.cacheSystemPrompt(systemPrompt);

      // Store stable/dynamic split for cache-breakpoint injection (Manus AI #11/#20)
      try {
        const { buildStableDynamicSplit } = await import('../optimization/cache-breakpoints.js');
        const split = buildStableDynamicSplit(systemPrompt);
        // The split is used by the client to inject cache_control breakpoints.
        // Attach it to the PromptCacheManager for inspection if needed.
        (this.promptCacheManager as unknown as Record<string, unknown>)._stableDynamicSplit = split;
      } catch { /* non-critical */ }

      return systemPrompt;
    } catch (error) {
      // Fallback to legacy prompt on error
      logger.warn("Failed to load custom prompt, using default", { error: getErrorMessage(error) });
      const promptMode = this.config.yoloMode ? "yolo" : "default";
      return getSystemPromptForMode(
        promptMode,
        this.config.morphEditorEnabled,
        this.config.cwd,
        customInstructions || undefined
      );
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PromptBuilderConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

import {
  SKILL_MANAGE_TOOL,
  SKILLS_LIST_TOOL,
  SKILL_VIEW_TOOL,
} from '../../codebuddy/tool-definitions/agent-tools.js';
import type { ToolResult } from '../../types/index.js';
import {
  executeSkillsListTool,
  executeSkillViewTool,
} from '../skills-inspection-tool.js';
import { getCreateSkillTool } from '../create-skill-tool.js';
import { SkillDiscoveryTool } from '../skill-discovery-tool.js';
import {
  installResearchScriptSkillCandidate,
  listMaterializedResearchScriptSkillCandidatesWithInstallState,
  readMaterializedResearchScriptSkillCandidate,
  readMaterializedResearchScriptSkillCandidateWithInstallState,
  type ResearchScriptSkillCandidate,
  type ResearchScriptSkillCandidateWithInstallState,
} from '../../agent/research-script-skill-candidate.js';
import { getSkillsHub } from '../../skills/hub.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';

class CodeBuddyToolAdapter implements ITool {
  constructor(
    private readonly tool: typeof SKILLS_LIST_TOOL | typeof SKILL_VIEW_TOOL,
    private readonly executor: (input: Record<string, unknown>) => Promise<ToolResult>,
    private readonly keywords: string[],
  ) {}

  get name(): string {
    return this.tool.function.name;
  }

  get description(): string {
    return this.tool.function.description;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await this.executor(input);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: this.tool.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    if (this.name === 'skill_view') {
      const name = (input as Record<string, unknown>).name;
      if (typeof name !== 'string' || name.trim().length === 0) {
        return { valid: false, errors: ['name is required'] };
      }
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: this.keywords,
      priority: this.name === 'skill_view' ? 6 : 5,
      modifiesFiles: false,
      makesNetworkRequests: false,
      fleetSafe: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

type SkillManageAction =
  | 'list'
  | 'view'
  | 'history'
  | 'create'
  | 'discover'
  | 'enable'
  | 'disable'
  | 'deprecate'
  | 'delete'
  | 'patch'
  | 'rollback'
  | 'update'
  | 'candidate_list'
  | 'candidate_view'
  | 'candidate_install';

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readRawString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return strings.length > 0 ? strings : undefined;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function serializePayload(payload: Record<string, unknown>): ToolResult {
  return {
    success: true,
    output: JSON.stringify(payload, null, 2),
    data: payload,
  };
}

function readApproval(input: Record<string, unknown>, action: string): string | ToolResult {
  const approvedBy = readString(input.approved_by);
  if (!approvedBy) {
    return { success: false, error: `skill_manage ${action}: approved_by is required` };
  }
  return approvedBy;
}

type SkillCandidateSummarySource = ResearchScriptSkillCandidate
  & Partial<ResearchScriptSkillCandidateWithInstallState>;

function summarizeCandidate(candidate: SkillCandidateSummarySource): Record<string, unknown> {
  return {
    ...(candidate.candidateChecksum ? { candidateChecksum: candidate.candidateChecksum } : {}),
    ...(candidate.candidateDiffPreview ? { candidateDiffPreview: candidate.candidateDiffPreview } : {}),
    eligible: candidate.eligible,
    id: candidate.id,
    ...(candidate.installState ? { installState: candidate.installState } : {}),
    ...(candidate.installedChecksum ? { installedChecksum: candidate.installedChecksum } : {}),
    ...(typeof candidate.installedIntegrityOk === 'boolean'
      ? { installedIntegrityOk: candidate.installedIntegrityOk }
      : {}),
    ...(candidate.installedPath ? { installedPath: candidate.installedPath } : {}),
    ...(candidate.installedVersion ? { installedVersion: candidate.installedVersion } : {}),
    kind: candidate.kind,
    reason: candidate.reason,
    ...(candidate.reviewCommands ? { reviewCommands: candidate.reviewCommands } : {}),
    skillName: candidate.skillName,
    skillPath: candidate.skillPath,
    sourceJobId: candidate.sourceJobId,
    ...(candidate.sourceRunId ? { sourceRunId: candidate.sourceRunId } : {}),
    successfulRunCount: candidate.successfulRunCount,
    title: candidate.title,
    ...(candidate.toolSequence ? { toolSequence: candidate.toolSequence } : {}),
  };
}

function candidateReviewPath(candidate: ResearchScriptSkillCandidate): string {
  return candidate.skillPath.replace(/\\/g, '/').replace(/\/?SKILL\.md$/i, '/candidate-review.json');
}

export class SkillManageExecuteTool implements ITool {
  readonly name = SKILL_MANAGE_TOOL.function.name;
  readonly description = SKILL_MANAGE_TOOL.function.description;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = readString(input.action) as SkillManageAction | '';

    if (action === 'list') {
      return await executeSkillsListTool(input);
    }

    if (action === 'view') {
      return await executeSkillViewTool(input);
    }

    if (action === 'history') {
      const name = readString(input.name);
      if (!name) {
        return { success: false, error: 'skill_manage history: name is required' };
      }

      const history = getSkillsHub().getInstalledSkillHistory(name);
      if (!history) {
        return { success: false, error: `skill_manage history: skill not found: ${name}` };
      }

      return serializePayload({
        action: 'skill_manage_history',
        ...history,
      });
    }

    if (action === 'create') {
      const name = readString(input.name);
      const description = readString(input.description);
      const body = readString(input.body);

      if (!name) {
        return { success: false, error: 'skill_manage create: name is required' };
      }
      if (!description) {
        return { success: false, error: 'skill_manage create: description is required' };
      }
      if (!body) {
        return { success: false, error: 'skill_manage create: body is required' };
      }

      return await getCreateSkillTool().execute({
        name,
        description,
        body,
        tags: readStringArray(input.tags),
        env: readStringRecord(input.env),
        requires: readStringArray(input.requires),
        overwrite: input.overwrite === true,
      });
    }

    if (action === 'discover') {
      const query = readString(input.query);
      if (!query) {
        return { success: false, error: 'skill_manage discover: query is required' };
      }

      return await new SkillDiscoveryTool().execute({
        query,
        tags: readStringArray(input.tags),
        auto_install: input.auto_install === true,
        limit: typeof input.limit === 'number' ? input.limit : undefined,
      });
    }

    if (action === 'enable' || action === 'disable' || action === 'deprecate') {
      const name = readString(input.name);
      if (!name) {
        return { success: false, error: `skill_manage ${action}: name is required` };
      }

      const approval = readApproval(input, action);
      if (typeof approval !== 'string') {
        return approval;
      }

      const enabled = action === 'enable';
      const installed = getSkillsHub().setEnabled(name, enabled, {
        actor: approval,
        reason: readString(input.reason) || undefined,
        status: action === 'deprecate' ? 'deprecated' : enabled ? 'active' : 'disabled',
      });
      if (!installed) {
        return { success: false, error: `skill_manage ${action}: skill not found: ${name}` };
      }

      return serializePayload({
        action: `skill_manage_${action}`,
        installed,
      });
    }

    if (action === 'delete') {
      const name = readString(input.name);
      if (!name) {
        return { success: false, error: 'skill_manage delete: name is required' };
      }

      const approval = readApproval(input, action);
      if (typeof approval !== 'string') {
        return approval;
      }

      const before = getSkillsHub().info(name);
      const removed = await getSkillsHub().uninstall(name);
      if (!removed) {
        return { success: false, error: `skill_manage delete: skill not found: ${name}` };
      }

      return serializePayload({
        action: 'skill_manage_delete',
        removed: true,
        approvedBy: approval,
        name,
        previous: before?.installed,
      });
    }

    if (action === 'patch') {
      const name = readString(input.name);
      const oldText = readRawString(input.old_text);
      const newText = readRawString(input.new_text);
      if (!name) {
        return { success: false, error: 'skill_manage patch: name is required' };
      }
      if (oldText === undefined || oldText.length === 0) {
        return { success: false, error: 'skill_manage patch: old_text is required' };
      }
      if (newText === undefined) {
        return { success: false, error: 'skill_manage patch: new_text is required' };
      }

      const approval = readApproval(input, action);
      if (typeof approval !== 'string') {
        return approval;
      }

      try {
        const patched = getSkillsHub().patchInstalledSkill(name, oldText, newText, {
          actor: approval,
          expectedReplacements: typeof input.expected_replacements === 'number'
            ? input.expected_replacements
            : undefined,
          reason: readString(input.reason) || undefined,
        });
        if (!patched) {
          return { success: false, error: `skill_manage patch: skill not found: ${name}` };
        }

        return serializePayload({
          action: 'skill_manage_patch',
          ...patched,
        });
      } catch (error) {
        return {
          success: false,
          error: `skill_manage patch: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    if (action === 'rollback') {
      const name = readString(input.name);
      if (!name) {
        return { success: false, error: 'skill_manage rollback: name is required' };
      }

      const approval = readApproval(input, action);
      if (typeof approval !== 'string') {
        return approval;
      }

      try {
        const rolledBack = getSkillsHub().rollbackInstalledSkill(
          name,
          readString(input.snapshot_id) || undefined,
          {
            actor: approval,
            reason: readString(input.reason) || undefined,
          },
        );
        if (!rolledBack) {
          return { success: false, error: `skill_manage rollback: skill not found: ${name}` };
        }

        return serializePayload({
          action: 'skill_manage_rollback',
          ...rolledBack,
        });
      } catch (error) {
        return {
          success: false,
          error: `skill_manage rollback: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    if (action === 'update') {
      const name = readString(input.name);
      if (!name) {
        return { success: false, error: 'skill_manage update: name is required' };
      }

      const approval = readApproval(input, action);
      if (typeof approval !== 'string') {
        return approval;
      }

      try {
        const updated = await getSkillsHub().updateInstalledSkill(name, {
          actor: approval,
          force: input.force === true,
          reason: readString(input.reason) || undefined,
          version: readString(input.version) || undefined,
        });
        if (!updated) {
          return { success: false, error: `skill_manage update: skill not found: ${name}` };
        }

        return serializePayload({
          action: 'skill_manage_update',
          ...updated,
        });
      } catch (error) {
        return {
          success: false,
          error: `skill_manage update: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    if (action === 'candidate_list') {
      const candidates = await listMaterializedResearchScriptSkillCandidatesWithInstallState({
        rootDir: process.cwd(),
        skillRoot: readString(input.skill_root) || undefined,
      });
      const shown = input.eligible_only === true
        ? candidates.filter((candidate) => candidate.eligible)
        : candidates;

      return serializePayload({
        action: 'skill_manage_candidate_list',
        count: shown.length,
        total: candidates.length,
        candidates: shown.map(summarizeCandidate),
      });
    }

    if (action === 'candidate_view') {
      const candidatePath = readString(input.candidate_path);
      if (!candidatePath) {
        return { success: false, error: 'skill_manage candidate_view: candidate_path is required' };
      }
      const candidate = await readMaterializedResearchScriptSkillCandidateWithInstallState(candidatePath, {
        rootDir: process.cwd(),
      });

      return serializePayload({
        action: 'skill_manage_candidate_view',
        candidate: summarizeCandidate(candidate),
        reviewManifestPath: candidateReviewPath(candidate),
        ...(input.include_content === false ? {} : { content: candidate.markdown }),
      });
    }

    if (action === 'candidate_install') {
      const candidatePath = readString(input.candidate_path);
      const approvedBy = readString(input.approved_by);
      if (!candidatePath) {
        return { success: false, error: 'skill_manage candidate_install: candidate_path is required' };
      }
      if (!approvedBy) {
        return { success: false, error: 'skill_manage candidate_install: approved_by is required' };
      }

      const candidate = await readMaterializedResearchScriptSkillCandidate(candidatePath, {
        rootDir: process.cwd(),
      });
      const installed = await installResearchScriptSkillCandidate(candidate, {
        approvedAt: readString(input.approved_at) || undefined,
        approvedBy,
        overwrite: input.overwrite === true,
        rootDir: process.cwd(),
        workspaceSkillRoot: readString(input.workspace_skill_root) || undefined,
      });

      return serializePayload({
        action: 'skill_manage_candidate_install',
        candidate: summarizeCandidate(candidate),
        installed,
      });
    }

    return {
      success: false,
      error: 'skill_manage: action must be one of list, view, history, create, discover, enable, disable, deprecate, delete, patch, rollback, update, candidate_list, candidate_view, candidate_install',
    };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: SKILL_MANAGE_TOOL.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;
    const action = readString(data.action);
    if (![
      'list',
      'view',
      'history',
      'create',
      'discover',
      'enable',
      'disable',
      'deprecate',
      'delete',
      'patch',
      'rollback',
      'update',
      'candidate_list',
      'candidate_view',
      'candidate_install',
    ].includes(action)) {
      return {
        valid: false,
        errors: ['action must be one of list, view, history, create, discover, enable, disable, deprecate, delete, patch, rollback, update, candidate_list, candidate_view, candidate_install'],
      };
    }
    if ((action === 'view' || action === 'history') && !readString(data.name)) {
      return { valid: false, errors: [`name is required for ${action}`] };
    }
    if (action === 'discover' && !readString(data.query)) {
      return { valid: false, errors: ['query is required for discover'] };
    }
    if (action === 'create') {
      const missing = ['name', 'description', 'body'].filter((key) => !readString(data[key]));
      if (missing.length > 0) {
        return { valid: false, errors: [`${missing.join(', ')} required for create`] };
      }
    }
    if (['enable', 'disable', 'deprecate', 'delete'].includes(action)) {
      const missing = ['name', 'approved_by'].filter((key) => !readString(data[key]));
      if (missing.length > 0) {
        return { valid: false, errors: [`${missing.join(', ')} required for ${action}`] };
      }
    }
    if (action === 'patch') {
      const missing = ['name', 'approved_by', 'old_text', 'new_text'].filter((key) => {
        if (key === 'old_text') return readRawString(data[key]) === undefined || readRawString(data[key]) === '';
        if (key === 'new_text') return readRawString(data[key]) === undefined;
        return !readString(data[key]);
      });
      if (missing.length > 0) {
        return { valid: false, errors: [`${missing.join(', ')} required for patch`] };
      }
    }
    if (action === 'rollback') {
      const missing = ['name', 'approved_by'].filter((key) => !readString(data[key]));
      if (missing.length > 0) {
        return { valid: false, errors: [`${missing.join(', ')} required for rollback`] };
      }
    }
    if (action === 'update') {
      const missing = ['name', 'approved_by'].filter((key) => !readString(data[key]));
      if (missing.length > 0) {
        return { valid: false, errors: [`${missing.join(', ')} required for update`] };
      }
    }
    if (action === 'candidate_view' && !readString(data.candidate_path)) {
      return { valid: false, errors: ['candidate_path is required for candidate_view'] };
    }
    if (action === 'candidate_install') {
      const missing = ['candidate_path', 'approved_by'].filter((key) => !readString(data[key]));
      if (missing.length > 0) {
        return { valid: false, errors: [`${missing.join(', ')} required for candidate_install`] };
      }
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: [
        'skills',
        'skill',
        'manage',
        'list',
        'view',
        'history',
        'create',
        'discover',
        'candidate',
        'review',
        'install',
        'enable',
        'disable',
        'deprecate',
        'delete',
        'patch',
        'rollback',
        'update',
        'hermes',
      ],
      priority: 6,
      modifiesFiles: true,
      makesNetworkRequests: true,
      fleetSafe: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createSkillsInspectionTools(): ITool[] {
  return [
    new CodeBuddyToolAdapter(
      SKILLS_LIST_TOOL,
      executeSkillsListTool,
      ['skills', 'skill', 'list', 'installed', 'enabled', 'disabled', 'hermes'],
    ),
    new CodeBuddyToolAdapter(
      SKILL_VIEW_TOOL,
      executeSkillViewTool,
      ['skills', 'skill', 'view', 'read', 'content', 'inspect', 'show', 'hermes'],
    ),
    new SkillManageExecuteTool(),
  ];
}

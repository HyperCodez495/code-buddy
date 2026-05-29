/**
 * Task Management Integration
 *
 * Provides integration with task management platforms:
 * - Jira (Atlassian)
 * - Linear
 *
 * Features:
 * - Create/update issues
 * - Link commits to issues
 * - Sync status
 * - Query issues
 */

import { EventEmitter } from 'events';

export type TaskPlatform = 'jira' | 'linear';

export interface TaskManagementConfig {
  platform: TaskPlatform;
  apiKey: string;
  baseUrl?: string; // For Jira (e.g., https://yourcompany.atlassian.net)
  projectKey?: string;
  teamId?: string; // For Linear
}

export interface Issue {
  id: string;
  key: string; // e.g., PROJ-123 for Jira, ABC-123 for Linear
  title: string;
  description?: string;
  status: string;
  priority: IssuePriority;
  type: IssueType;
  assignee?: string;
  labels: string[];
  url: string;
  createdAt: Date;
  updatedAt: Date;
}

export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type IssueType = 'bug' | 'feature' | 'task' | 'story' | 'epic' | 'subtask';
export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'canceled';

export interface CreateIssueOptions {
  title: string;
  description?: string;
  type?: IssueType;
  priority?: IssuePriority;
  labels?: string[];
  assignee?: string;
  parentKey?: string;
}

export interface UpdateIssueOptions {
  title?: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  labels?: string[];
  assignee?: string;
}

export interface IssueQuery {
  status?: IssueStatus | IssueStatus[];
  assignee?: string;
  labels?: string[];
  type?: IssueType;
  search?: string;
  limit?: number;
}

export interface Comment {
  id: string;
  body: string;
  author: string;
  createdAt: Date;
}

/**
 * Abstract base class for task management integrations
 */
abstract class TaskManagementClient extends EventEmitter {
  protected config: TaskManagementConfig;

  constructor(config: TaskManagementConfig) {
    super();
    this.config = config;
  }

  abstract getIssue(key: string): Promise<Issue | null>;
  abstract createIssue(options: CreateIssueOptions): Promise<Issue>;
  abstract updateIssue(key: string, options: UpdateIssueOptions): Promise<Issue>;
  abstract queryIssues(query: IssueQuery): Promise<Issue[]>;
  abstract addComment(key: string, body: string): Promise<Comment>;
  abstract linkCommit(key: string, commitSha: string, message: string): Promise<void>;
  abstract getStatuses(): Promise<string[]>;
  abstract testConnection(): Promise<boolean>;
}

/**
 * Jira Integration Client
 */
export class JiraClient extends TaskManagementClient {
  private baseUrl: string;

  constructor(config: TaskManagementConfig) {
    super(config);
    if (!config.baseUrl) {
      throw new Error('Jira requires baseUrl (e.g., https://yourcompany.atlassian.net)');
    }
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: object
  ): Promise<T> {
    const url = `${this.baseUrl}/rest/api/3${endpoint}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`email:${this.config.apiKey}`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jira API error: ${response.status} - ${error}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  private mapPriority(priority: string): IssuePriority {
    const map: Record<string, IssuePriority> = {
      Highest: 'urgent',
      High: 'high',
      Medium: 'medium',
      Low: 'low',
      Lowest: 'none',
    };
    return map[priority] || 'medium';
  }

  private mapType(type: string): IssueType {
    const map: Record<string, IssueType> = {
      Bug: 'bug',
      Story: 'story',
      Task: 'task',
      Epic: 'epic',
      'Sub-task': 'subtask',
    };
    return map[type] || 'task';
  }

  private parseIssue(data: JiraIssueResponse): Issue {
    return {
      id: data.id,
      key: data.key,
      title: data.fields.summary,
      description: data.fields.description?.content?.[0]?.content?.[0]?.text,
      status: data.fields.status.name,
      priority: this.mapPriority(data.fields.priority?.name || 'Medium'),
      type: this.mapType(data.fields.issuetype.name),
      assignee: data.fields.assignee?.displayName,
      labels: data.fields.labels || [],
      url: `${this.baseUrl}/browse/${data.key}`,
      createdAt: new Date(data.fields.created),
      updatedAt: new Date(data.fields.updated),
    };
  }

  async getIssue(key: string): Promise<Issue | null> {
    try {
      const data = await this.request<JiraIssueResponse>('GET', `/issue/${key}`);
      return this.parseIssue(data);
    } catch {
      return null;
    }
  }

  async createIssue(options: CreateIssueOptions): Promise<Issue> {
    const issueData = {
      fields: {
        project: { key: this.config.projectKey },
        summary: options.title,
        description: options.description
          ? {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: options.description }],
                },
              ],
            }
          : undefined,
        issuetype: { name: this.getJiraType(options.type || 'task') },
        labels: options.labels,
      },
    };

    const created = await this.request<JiraIssueResponse>('POST', '/issue', issueData);
    const issue = await this.getIssue(created.key);
    if (!issue) throw new Error('Failed to fetch created issue');
    return issue;
  }

  async updateIssue(key: string, options: UpdateIssueOptions): Promise<Issue> {
    const updateData: JiraUpdateFields = { fields: {} };

    if (options.title) updateData.fields.summary = options.title;
    if (options.labels) updateData.fields.labels = options.labels;
    if (options.description) {
      updateData.fields.description = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: options.description }],
          },
        ],
      };
    }

    await this.request('PUT', `/issue/${key}`, updateData);

    // Handle status transition separately
    if (options.status) {
      await this.transitionIssue(key, options.status);
    }

    const issue = await this.getIssue(key);
    if (!issue) throw new Error('Failed to fetch updated issue');
    return issue;
  }

  private async transitionIssue(key: string, status: IssueStatus): Promise<void> {
    const transitions = await this.request<{ transitions: Array<{ id: string; name: string }> }>(
      'GET',
      `/issue/${key}/transitions`
    );

    const statusMap: Record<IssueStatus, string[]> = {
      backlog: ['Backlog', 'Open'],
      todo: ['To Do', 'Open', 'Reopened'],
      in_progress: ['In Progress', 'In Development'],
      review: ['In Review', 'Code Review'],
      done: ['Done', 'Closed', 'Resolved'],
      canceled: ['Canceled', 'Won\'t Do', 'Won\'t Fix'],
    };

    const targetNames = statusMap[status] || [status];
    const transition = transitions.transitions.find((t) =>
      targetNames.some((name) => t.name.toLowerCase() === name.toLowerCase())
    );

    if (transition) {
      await this.request('POST', `/issue/${key}/transitions`, {
        transition: { id: transition.id },
      });
    }
  }

  async queryIssues(query: IssueQuery): Promise<Issue[]> {
    const jql: string[] = [];

    if (this.config.projectKey) {
      jql.push(`project = ${this.config.projectKey}`);
    }

    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      jql.push(`status IN (${statuses.map((s) => `"${s}"`).join(', ')})`);
    }

    if (query.assignee) {
      jql.push(`assignee = "${query.assignee}"`);
    }

    if (query.labels && query.labels.length > 0) {
      jql.push(`labels IN (${query.labels.map((l) => `"${l}"`).join(', ')})`);
    }

    if (query.search) {
      jql.push(`text ~ "${query.search}"`);
    }

    const jqlString = jql.length > 0 ? jql.join(' AND ') : 'ORDER BY created DESC';
    const limit = query.limit || 50;

    const result = await this.request<{ issues: JiraIssueResponse[] }>(
      'GET',
      `/search?jql=${encodeURIComponent(jqlString)}&maxResults=${limit}`
    );

    return result.issues.map((issue) => this.parseIssue(issue));
  }

  async addComment(key: string, body: string): Promise<Comment> {
    const result = await this.request<JiraCommentResponse>('POST', `/issue/${key}/comment`, {
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: body }],
          },
        ],
      },
    });

    return {
      id: result.id,
      body: body,
      author: result.author.displayName,
      createdAt: new Date(result.created),
    };
  }

  async linkCommit(key: string, commitSha: string, message: string): Promise<void> {
    await this.addComment(key, `Commit: ${commitSha}\n\n${message}`);
  }

  async getStatuses(): Promise<string[]> {
    const result = await this.request<Array<{ name: string }>>('GET', '/status');
    return result.map((s) => s.name);
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.request('GET', '/myself');
      return true;
    } catch {
      return false;
    }
  }

  private getJiraType(type: IssueType): string {
    const map: Record<IssueType, string> = {
      bug: 'Bug',
      feature: 'Story',
      task: 'Task',
      story: 'Story',
      epic: 'Epic',
      subtask: 'Sub-task',
    };
    return map[type] || 'Task';
  }
}

/**
 * Linear Integration Client
 */
export class LinearClient extends TaskManagementClient {
  private readonly apiUrl = 'https://api.linear.app/graphql';

  private async graphql<T>(query: string, variables?: object): Promise<T> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: this.config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Linear API error: ${response.status} - ${error}`);
    }

    const result = (await response.json()) as GraphQLResponse<T>;
    if (result.errors) {
      throw new Error(`Linear GraphQL error: ${result.errors[0]?.message ?? 'unknown error'}`);
    }

    return result.data;
  }

  private mapPriority(priority: number): IssuePriority {
    const map: Record<number, IssuePriority> = {
      0: 'none',
      1: 'urgent',
      2: 'high',
      3: 'medium',
      4: 'low',
    };
    return map[priority] || 'medium';
  }

  private parseIssue(data: LinearIssueNode): Issue {
    return {
      id: data.id,
      key: data.identifier,
      title: data.title,
      description: data.description,
      status: data.state.name,
      priority: this.mapPriority(data.priority),
      type: data.labels?.nodes?.some((l) => l.name.toLowerCase() === 'bug') ? 'bug' : 'task',
      assignee: data.assignee?.name,
      labels: data.labels?.nodes?.map((l) => l.name) || [],
      url: data.url,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  async getIssue(key: string): Promise<Issue | null> {
    const query = `
      query GetIssue($key: String!) {
        issue(id: $key) {
          id
          identifier
          title
          description
          priority
          url
          createdAt
          updatedAt
          state { name }
          assignee { name }
          labels { nodes { name } }
        }
      }
    `;

    try {
      const result = await this.graphql<{ issue: LinearIssueNode }>(query, { key });
      return result.issue ? this.parseIssue(result.issue) : null;
    } catch {
      return null;
    }
  }

  async createIssue(options: CreateIssueOptions): Promise<Issue> {
    const query = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            description
            priority
            url
            createdAt
            updatedAt
            state { name }
            assignee { name }
            labels { nodes { name } }
          }
        }
      }
    `;

    const priorityMap: Record<IssuePriority, number> = {
      urgent: 1,
      high: 2,
      medium: 3,
      low: 4,
      none: 0,
    };

    const result = await this.graphql<{ issueCreate: { issue: LinearIssueNode } }>(query, {
      input: {
        teamId: this.config.teamId,
        title: options.title,
        description: options.description,
        priority: priorityMap[options.priority || 'medium'],
        labelIds: options.labels,
        assigneeId: options.assignee,
      },
    });

    return this.parseIssue(result.issueCreate.issue);
  }

  async updateIssue(key: string, options: UpdateIssueOptions): Promise<Issue> {
    // First get the issue to find its ID
    const issue = await this.getIssue(key);
    if (!issue) throw new Error(`Issue not found: ${key}`);

    const query = `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id
            identifier
            title
            description
            priority
            url
            createdAt
            updatedAt
            state { name }
            assignee { name }
            labels { nodes { name } }
          }
        }
      }
    `;

    const input: Record<string, unknown> = {};
    if (options.title) input.title = options.title;
    if (options.description) input.description = options.description;
    if (options.priority) {
      const priorityMap: Record<IssuePriority, number> = {
        urgent: 1,
        high: 2,
        medium: 3,
        low: 4,
        none: 0,
      };
      input.priority = priorityMap[options.priority];
    }

    const result = await this.graphql<{ issueUpdate: { issue: LinearIssueNode } }>(query, {
      id: issue.id,
      input,
    });

    return this.parseIssue(result.issueUpdate.issue);
  }

  async queryIssues(query: IssueQuery): Promise<Issue[]> {
    const gqlQuery = `
      query Issues($teamId: String, $first: Int, $filter: IssueFilter) {
        issues(first: $first, filter: $filter) {
          nodes {
            id
            identifier
            title
            description
            priority
            url
            createdAt
            updatedAt
            state { name }
            assignee { name }
            labels { nodes { name } }
          }
        }
      }
    `;

    const filter: Record<string, unknown> = {};
    if (this.config.teamId) {
      filter.team = { id: { eq: this.config.teamId } };
    }
    if (query.search) {
      filter.title = { contains: query.search };
    }
    if (query.assignee) {
      filter.assignee = { name: { eq: query.assignee } };
    }

    const result = await this.graphql<{ issues: { nodes: LinearIssueNode[] } }>(gqlQuery, {
      teamId: this.config.teamId,
      first: query.limit || 50,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
    });

    return result.issues.nodes.map((issue) => this.parseIssue(issue));
  }

  async addComment(key: string, body: string): Promise<Comment> {
    const issue = await this.getIssue(key);
    if (!issue) throw new Error(`Issue not found: ${key}`);

    const query = `
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment {
            id
            body
            createdAt
            user { name }
          }
        }
      }
    `;

    const result = await this.graphql<{
      commentCreate: { comment: { id: string; body: string; createdAt: string; user: { name: string } } };
    }>(query, {
      input: {
        issueId: issue.id,
        body,
      },
    });

    return {
      id: result.commentCreate.comment.id,
      body: result.commentCreate.comment.body,
      author: result.commentCreate.comment.user.name,
      createdAt: new Date(result.commentCreate.comment.createdAt),
    };
  }

  async linkCommit(key: string, commitSha: string, message: string): Promise<void> {
    await this.addComment(key, `Linked commit: \`${commitSha}\`\n\n${message}`);
  }

  async getStatuses(): Promise<string[]> {
    const query = `
      query WorkflowStates($teamId: String) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }) {
          nodes { name }
        }
      }
    `;

    const result = await this.graphql<{ workflowStates: { nodes: Array<{ name: string }> } }>(query, {
      teamId: this.config.teamId,
    });

    return result.workflowStates.nodes.map((s) => s.name);
  }

  async testConnection(): Promise<boolean> {
    try {
      const query = `query { viewer { id } }`;
      await this.graphql(query);
      return true;
    } catch {
      return false;
    }
  }
}

// Type definitions for API responses
interface JiraIssueResponse {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: {
      content?: Array<{
        content?: Array<{ text?: string }>;
      }>;
    };
    status: { name: string };
    priority?: { name: string };
    issuetype: { name: string };
    assignee?: { displayName: string };
    labels: string[];
    created: string;
    updated: string;
  };
}

interface JiraUpdateFields {
  fields: {
    summary?: string;
    description?: object;
    labels?: string[];
  };
}

interface JiraCommentResponse {
  id: string;
  body: object;
  author: { displayName: string };
  created: string;
}

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority: number;
  url: string;
  createdAt: string;
  updatedAt: string;
  state: { name: string };
  assignee?: { name: string };
  labels?: { nodes: Array<{ name: string }> };
}

interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

/**
 * Task Management Integration Manager
 */
export class TaskManagementIntegration extends EventEmitter {
  private client: TaskManagementClient | null = null;
  private config: TaskManagementConfig | null = null;

  /**
   * Configure the task management integration
   */
  configure(config: TaskManagementConfig): void {
    this.config = config;

    switch (config.platform) {
      case 'jira':
        this.client = new JiraClient(config);
        break;
      case 'linear':
        this.client = new LinearClient(config);
        break;
      default:
        throw new Error(`Unsupported platform: ${config.platform}`);
    }

    this.emit('configured', config.platform);
  }

  /**
   * Get the current client
   */
  private getClient(): TaskManagementClient {
    if (!this.client) {
      throw new Error('Task management not configured. Call configure() first.');
    }
    return this.client;
  }

  /**
   * Get an issue by key
   */
  async getIssue(key: string): Promise<Issue | null> {
    return this.getClient().getIssue(key);
  }

  /**
   * Create a new issue
   */
  async createIssue(options: CreateIssueOptions): Promise<Issue> {
    const issue = await this.getClient().createIssue(options);
    this.emit('issueCreated', issue);
    return issue;
  }

  /**
   * Update an existing issue
   */
  async updateIssue(key: string, options: UpdateIssueOptions): Promise<Issue> {
    const issue = await this.getClient().updateIssue(key, options);
    this.emit('issueUpdated', issue);
    return issue;
  }

  /**
   * Query issues
   */
  async queryIssues(query: IssueQuery): Promise<Issue[]> {
    return this.getClient().queryIssues(query);
  }

  /**
   * Add a comment to an issue
   */
  async addComment(key: string, body: string): Promise<Comment> {
    const comment = await this.getClient().addComment(key, body);
    this.emit('commentAdded', { key, comment });
    return comment;
  }

  /**
   * Link a commit to an issue
   */
  async linkCommit(key: string, commitSha: string, message: string): Promise<void> {
    await this.getClient().linkCommit(key, commitSha, message);
    this.emit('commitLinked', { key, commitSha });
  }

  /**
   * Get available statuses
   */
  async getStatuses(): Promise<string[]> {
    return this.getClient().getStatuses();
  }

  /**
   * Test the connection
   */
  async testConnection(): Promise<boolean> {
    return this.getClient().testConnection();
  }

  /**
   * Extract issue keys from commit message
   */
  extractIssueKeys(message: string): string[] {
    // Match patterns like: PROJ-123, ABC-456, fixes #123
    const patterns = [
      /([A-Z]+-\d+)/g, // Jira/Linear style
      /(?:fixes?|closes?|resolves?)\s+#(\d+)/gi, // GitHub style
    ];

    const keys: string[] = [];
    for (const pattern of patterns) {
      const matches = message.matchAll(pattern);
      for (const match of matches) {
        const key = match[1];
        if (key === undefined) continue;
        keys.push(key);
      }
    }

    return [...new Set(keys)];
  }

  /**
   * Get current platform
   */
  getPlatform(): TaskPlatform | null {
    return this.config?.platform || null;
  }

  /**
   * Check if configured
   */
  isConfigured(): boolean {
    return this.client !== null;
  }
}

// Singleton instance
let taskManagementInstance: TaskManagementIntegration | null = null;

/**
 * Get the task management integration instance
 */
export function getTaskManagement(): TaskManagementIntegration {
  if (!taskManagementInstance) {
    taskManagementInstance = new TaskManagementIntegration();
  }
  return taskManagementInstance;
}

export default TaskManagementIntegration;

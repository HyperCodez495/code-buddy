/**
 * A2A Protocol Routes
 *
 * Google Agent-to-Agent protocol endpoints:
 * - GET  /api/a2a/.well-known/agent.json — Agent card discovery
 * - GET  /api/a2a/agents — List registered agents
 * - POST /api/a2a/tasks/send — Submit a task to an agent
 * - GET  /api/a2a/tasks/:id — Get task status
 * - POST /api/a2a/tasks/:id/cancel — Cancel a task
 */

import { Router } from 'express';
import { asyncHandler, requireScope } from '../middleware/index.js';
import {
  A2AAgentClient,
  A2AAgentServer,
  type AgentCard,
  createAgentCard,
  getTaskResult,
} from '../../protocols/a2a/index.js';

function getAgentServer(client: A2AAgentClient, name: string): A2AAgentServer | undefined {
  return (client as unknown as { agents: Map<string, A2AAgentServer> }).agents?.get(name);
}

/**
 * Normalise the inbound `message` field of POST /tasks/send into a plain string.
 * Accepts either a raw string or an A2A Message object `{role, parts: [{type:'text', text}]}`,
 * which is what cross-host callers send. submitTask() expects a string and embeds it
 * verbatim into a Message; passing an object would nest it as `text: <object>` and
 * the downstream spoke would forward garbage to its model backend.
 */
function extractMessageText(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message && typeof message === 'object') {
    const parts = (message as { parts?: unknown }).parts;
    if (Array.isArray(parts)) {
      const texts = parts
        .filter((p): p is { type: string; text: string } =>
          !!p && typeof p === 'object' &&
          (p as { type?: unknown }).type === 'text' &&
          typeof (p as { text?: unknown }).text === 'string')
        .map((p) => p.text);
      if (texts.length > 0) return texts.join('\n');
    }
  }
  return JSON.stringify(message);
}

interface A2ARouter extends Router { a2aClient?: A2AAgentClient; }

export function createA2AProtocolRoutes(): Router {
  const router = Router();
  const client = new A2AAgentClient();

  // Agent card discovery (well-known endpoint per A2A spec)
  router.get('/.well-known/agent.json', (_req, res) => {
    const hostCard = createAgentCard({
      name: 'Code Buddy',
      description: 'Multi-provider AI coding agent with specialized sub-agents',
      skills: [
        { id: 'code-edit', name: 'Code Editing', description: 'Edit and refactor code', inputModes: ['text/plain'], outputModes: ['text/plain'] },
        { id: 'code-debug', name: 'Debugging', description: 'Find and fix bugs', inputModes: ['text/plain'], outputModes: ['text/plain'] },
        { id: 'code-review', name: 'Code Review', description: 'Analyze code quality', inputModes: ['text/plain'], outputModes: ['text/plain'] },
        { id: 'planning', name: 'Planning', description: 'Create and execute multi-step plans', inputModes: ['text/plain'], outputModes: ['text/plain'] },
      ],
    });
    res.json(hostCard);
  });

  // List registered agents (local in-process + remote cross-host)
  router.get('/agents', requireScope('admin'), (_req, res) => {
    const agents = client.listAgents();
    const cards = agents.map((name) => ({
      name,
      card: client.getAgentCard(name),
    }));
    const remotes = client.listRemoteAgents().map((r) => ({
      name: r.name,
      url: r.url,
      card: r.card,
      lastHeartbeat: r.lastHeartbeat,
    }));
    res.json({ agents: cards, remoteAgents: remotes });
  });

  // Submit a task. Body accepts EITHER {agent} (Niveau 2 explicit routing)
  // OR {skill} (Niveau 3 auto-routing — hub finds matching spoke and delegates).
  // Both `message` is required regardless of routing mode.
  router.post('/tasks/send', requireScope('admin'), asyncHandler(async (req, res) => {
    const { agent: agentName, skill: skillId, message } = req.body;

    if (!message) {
      res.status(400).json({ error: 'Missing required field: message' });
      return;
    }

    const resolved = client.resolveTarget({ agent: agentName, skill: skillId });
    if ('error' in resolved) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }

    try {
      const messageText = extractMessageText(message);
      const task = await client.submitTask(resolved.agentKey, messageText);
      res.json({
        id: task.id,
        status: task.status,
        result: getTaskResult(task),
        artifacts: task.artifacts,
        routedTo: resolved.agentKey,
      });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }));

  // Get task status
  router.get('/tasks/:id', requireScope('admin'), (req, res) => {
    // Search across all registered agents for the task
    for (const agentName of client.listAgents()) {
      const server = getAgentServer(client, agentName);
      if (server && typeof server.getTask === 'function') {
        const task = server.getTask(String(req.params.id));
        if (task) {
          res.json({
            id: task.id,
            status: task.status,
            result: getTaskResult(task),
            artifacts: task.artifacts,
            history: task.history,
          });
          return;
        }
      }
    }
    res.status(404).json({ error: 'Task not found' });
  });

  // Cancel a task
  router.post('/tasks/:id/cancel', requireScope('admin'), (req, res) => {
    for (const agentName of client.listAgents()) {
      const server = getAgentServer(client, agentName);
      if (server && typeof server.cancelTask === 'function') {
        const cancelled = server.cancelTask(String(req.params.id));
        if (cancelled) {
          res.json({ cancelled: true, id: req.params.id });
          return;
        }
      }
    }
    res.status(404).json({ error: 'Task not found or already completed' });
  });

  // Find agents by skill
  router.get('/agents/by-skill/:skillId', requireScope('admin'), (req, res) => {
    const skillId = String(req.params.skillId);
    const agents = client.findAgentsWithSkill(skillId);
    res.json({ skill: skillId, agents });
  });

  // ── Fleet endpoints (V0.3 — register/heartbeat for cross-host spokes) ──
  //
  // Auth: scope 'read' (lower than 'admin') so any tailnet client can register.
  // Mesh privé Tailscale = sécurité de base ; ouvrir 'admin' uniquement aux
  // opérations destructives (tasks/send arbitraire).

  // Register a remote agent's card (called by spoke at boot)
  // Body : { name: string, url: string, card: AgentCard }
  router.post('/agents/register', requireScope('read'), (req, res) => {
    const { name, url, card } = req.body || {};
    if (!name || typeof name !== 'string' ||
        !url || typeof url !== 'string' ||
        !card || typeof card !== 'object' ||
        !Array.isArray(card.skills)) {
      res.status(400).json({
        error: 'Missing or invalid fields. Required: name (string), url (string), card.skills (array)',
      });
      return;
    }
    client.registerRemoteCard(String(name), {
      url: String(url),
      card: card as AgentCard,
      lastHeartbeat: Date.now(),
    });
    res.json({ status: 'registered', agent: name, url });
  });

  // Heartbeat — called periodically by spoke to maintain liveness
  router.post('/agents/:name/heartbeat', requireScope('read'), (req, res) => {
    const ok = client.touchRemoteAgent(String(req.params.name));
    if (!ok) {
      res.status(404).json({ error: 'agent not registered' });
      return;
    }
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Unregister — called by spoke on graceful shutdown
  router.delete('/agents/:name', requireScope('read'), (req, res) => {
    const ok = client.unregisterRemoteAgent(String(req.params.name));
    if (!ok) {
      res.status(404).json({ error: 'agent not registered' });
      return;
    }
    res.json({ status: 'unregistered', agent: req.params.name });
  });

  // Expose the client for external registration
  (router as A2ARouter).a2aClient = client;

  return router;
}

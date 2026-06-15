import { GitBranch, RotateCcw, Zap, Route, Shield, Timer } from 'lucide-react';
import { FlowPattern } from './types';

export const flowPatterns: FlowPattern[] = [
  {
    id: 'if-then-else',
    name: 'If-Then-Else',
    description: 'Conditional branching based on data evaluation',
    icon: GitBranch,
    category: 'conditional',
    template: {
      nodes: [
        {
          id: 'condition',
          type: 'custom',
          position: { x: 200, y: 100 },
          data: {
            id: 'condition',
            type: 'condition',
            label: 'Condition',
            position: { x: 200, y: 100 },
            icon: 'GitBranch',
            color: '#3b82f6',
            inputs: 1,
            outputs: 2,
            config: {
              expression: 'data.value > 10',
              operator: 'greater_than',
              value: 10
            }
          }
        },
        {
          id: 'then-branch',
          type: 'custom',
          position: { x: 100, y: 250 },
          data: {
            id: 'then-branch',
            type: 'action',
            label: 'Then Action',
            position: { x: 100, y: 250 },
            icon: 'Play',
            color: '#10b981',
            inputs: 1,
            outputs: 1,
            config: {}
          }
        },
        {
          id: 'else-branch',
          type: 'custom',
          position: { x: 300, y: 250 },
          data: {
            id: 'else-branch',
            type: 'action',
            label: 'Else Action',
            position: { x: 300, y: 250 },
            icon: 'Play',
            color: '#ef4444',
            inputs: 1,
            outputs: 1,
            config: {}
          }
        }
      ],
      edges: [
        {
          id: 'condition-then',
          source: 'condition',
          target: 'then-branch',
          style: { stroke: '#10b981', strokeWidth: 2 },
          data: { condition: 'TRUE' }
        },
        {
          id: 'condition-else',
          source: 'condition',
          target: 'else-branch',
          style: { stroke: '#ef4444', strokeWidth: 2 },
          data: { condition: 'FALSE' }
        }
      ]
    }
  },
  {
    id: 'for-each-loop',
    name: 'For Each Loop',
    description: 'Iterate over a collection of items',
    icon: RotateCcw,
    category: 'loop',
    template: {
      nodes: [
        {
          id: 'loop-start',
          type: 'custom',
          position: { x: 200, y: 100 },
          data: {
            id: 'loop-start',
            type: 'loop',
            label: 'For Each',
            position: { x: 200, y: 100 },
            icon: 'RotateCcw',
            color: '#8b5cf6',
            inputs: 1,
            outputs: 2,
            config: {
              collection: 'data.items',
              itemVariable: 'item',
              maxIterations: 100
            }
          }
        },
        {
          id: 'loop-action',
          type: 'custom',
          position: { x: 200, y: 250 },
          data: {
            id: 'loop-action',
            type: 'action',
            label: 'Process Item',
            position: { x: 200, y: 250 },
            icon: 'Play',
            color: '#3b82f6',
            inputs: 1,
            outputs: 1,
            config: {}
          }
        },
        {
          id: 'loop-end',
          type: 'custom',
          position: { x: 200, y: 400 },
          data: {
            id: 'loop-end',
            type: 'action',
            label: 'Loop Complete',
            position: { x: 200, y: 400 },
            icon: 'CheckCircle',
            color: '#10b981',
            inputs: 1,
            outputs: 1,
            config: {}
          }
        }
      ],
      edges: [
        {
          id: 'start-action',
          source: 'loop-start',
          target: 'loop-action',
          style: { stroke: '#3b82f6', strokeWidth: 2 }
        },
        {
          id: 'action-back',
          source: 'loop-action',
          target: 'loop-start',
          style: { stroke: '#8b5cf6', strokeWidth: 2, strokeDasharray: '5,5' }
        },
        {
          id: 'loop-complete',
          source: 'loop-start',
          target: 'loop-end',
          style: { stroke: '#10b981', strokeWidth: 2 }
        }
      ]
    }
  },
  {
    id: 'parallel-execution',
    name: 'Parallel Execution',
    description: 'Execute multiple branches simultaneously',
    icon: Zap,
    category: 'parallel',
    template: {
      nodes: [
        {
          id: 'parallel-start',
          type: 'custom',
          position: { x: 200, y: 100 },
          data: {
            id: 'parallel-start',
            type: 'parallel',
            label: 'Parallel Start',
            position: { x: 200, y: 100 },
            icon: 'Zap',
            color: '#f59e0b',
            inputs: 1,
            outputs: 3,
            config: {
              mode: 'all',
              timeout: 30000
            }
          }
        },
        {
          id: 'branch-1',
          type: 'custom',
          position: { x: 100, y: 250 },
          data: {
            id: 'branch-1',
            type: 'action',
            label: 'Branch 1',
            position: { x: 100, y: 250 },
            icon: 'Play',
            color: '#3b82f6',
            inputs: 1,
            outputs: 1,
            config: {}
          }
        },
        {
          id: 'branch-2',
          type: 'custom',
          position: { x: 200, y: 250 },
          data: {
            id: 'branch-2',
            type: 'action',
            label: 'Branch 2',
            position: { x: 200, y: 250 },
            icon: 'Play',
            color: '#3b82f6',
            inputs: 1,
            outputs: 1,
            config: {}
          }
        },
        {
          id: 'branch-3',
          type: 'custom',
          position: { x: 300, y: 250 },
          data: {
            id: 'branch-3',
            type: 'action',
            label: 'Branch 3',
            position: { x: 300, y: 250 },
            icon: 'Play',
            color: '#3b82f6',
            inputs: 1,
            outputs: 1,
            config: {}
          }
        },
        {
          id: 'parallel-end',
          type: 'custom',
          position: { x: 200, y: 400 },
          data: {
            id: 'parallel-end',
            type: 'merge',
            label: 'Merge Results',
            position: { x: 200, y: 400 },
            icon: 'Merge',
            color: '#10b981',
            inputs: 3,
            outputs: 1,
            config: {}
          }
        }
      ],
      edges: [
        {
          id: 'start-branch1',
          source: 'parallel-start',
          target: 'branch-1',
          style: { stroke: '#3b82f6', strokeWidth: 2 }
        },
        {
          id: 'start-branch2',
          source: 'parallel-start',
          target: 'branch-2',
          style: { stroke: '#3b82f6', strokeWidth: 2 }
        },
        {
          id: 'start-branch3',
          source: 'parallel-start',
          target: 'branch-3',
          style: { stroke: '#3b82f6', strokeWidth: 2 }
        },
        {
          id: 'branch1-end',
          source: 'branch-1',
          target: 'parallel-end',
          style: { stroke: '#10b981', strokeWidth: 2 }
        },
        {
          id: 'branch2-end',
          source: 'branch-2',
          target: 'parallel-end',
          style: { stroke: '#10b981', strokeWidth: 2 }
        },
        {
          id: 'branch3-end',
          source: 'branch-3',
          target: 'parallel-end',
          style: { stroke: '#10b981', strokeWidth: 2 }
        }
      ]
    }
  },
  {
    id: 'smart-router',
    name: 'Smart Router',
    description: 'Route data to different paths based on content',
    icon: Route,
    category: 'router',
    template: {
      nodes: [
        {
          id: 'router',
          type: 'custom',
          position: { x: 200, y: 100 },
          data: {
            id: 'router',
            type: 'router',
            label: 'Smart Router',
            position: { x: 200, y: 100 },
            icon: 'Route',
            color: '#8b5cf6',
            inputs: 1,
            outputs: 4,
            config: {
              routingRules: [
                { condition: 'data.type === "email"', target: 'email-handler' },
                { condition: 'data.type === "sms"', target: 'sms-handler' },
                { condition: 'data.type === "webhook"', target: 'webhook-handler' }
              ],
              defaultRoute: 'default-handler'
            }
          }
        },
        {
          id: 'email-handler',
          type: 'custom',
          position: { x: 50, y: 250 },
          data: {
            id: 'email-handler',
            type: 'email',
            label: 'Email Handler',
            position: { x: 50, y: 250 },
            icon: 'Mail',
            color: '#3b82f6',
            inputs: 1,
            outputs: 1,
            config: {}
          }
        },
        {
          id: 'sms-handler',
          type: 'custom',
          position: { x: 150, y: 250 },
          data: {
            id: 'sms-handler',
            type: 'sms',
            label: 'SMS Handler',
            position: { x: 150, y: 250 },
            icon: 'MessageSquare',
            color: '#10b981',
            inputs: 1,
            outputs: 1,
            config: {}
          }
        },
        {
          id: 'webhook-handler',
          type: 'custom',
          position: { x: 250, y: 250 },
          data: {
            id: 'webhook-handler',
            type: 'webhook',
            label: 'Webhook Handler',
            position: { x: 250, y: 250 },
            icon: 'Webhook',
            color: '#8b5cf6',
            inputs: 1,
            outputs: 1,
            config: {}
          }
        },
        {
          id: 'default-handler',
          type: 'custom',
          position: { x: 350, y: 250 },
          data: {
            id: 'default-handler',
            type: 'action',
            label: 'Default Handler',
            position: { x: 350, y: 250 },
            icon: 'Play',
            color: '#6b7280',
            inputs: 1,
            outputs: 1,
            config: {}
          }
        }
      ],
      edges: [
        {
          id: 'router-email',
          source: 'router',
          target: 'email-handler',
          style: { stroke: '#3b82f6', strokeWidth: 2 },
          data: { condition: 'EMAIL' }
        },
        {
          id: 'router-sms',
          source: 'router',
          target: 'sms-handler',
          style: { stroke: '#10b981', strokeWidth: 2 },
          data: { condition: 'SMS' }
        },
        {
          id: 'router-webhook',
          source: 'router',
          target: 'webhook-handler',
          style: { stroke: '#8b5cf6', strokeWidth: 2 },
          data: { condition: 'WEBHOOK' }
        },
        {
          id: 'router-default',
          source: 'router',
          target: 'default-handler',
          style: { stroke: '#6b7280', strokeWidth: 2 },
          data: { condition: 'DEFAULT' }
        }
      ]
    }
  },
  {
    id: 'try-catch',
    name: 'Try-Catch',
    description: 'Error handling with fallback actions',
    icon: Shield,
    category: 'advanced',
    template: {
      nodes: [
        {
          id: 'try-block',
          type: 'custom',
          position: { x: 200, y: 100 },
          data: {
            id: 'try-block',
            type: 'try',
            label: 'Try Block',
            position: { x: 200, y: 100 },
            icon: 'Shield',
            color: '#3b82f6',
            inputs: 1,
            outputs: 1,
            config: {
              retryCount: 3,
              retryDelay: 1000
            }
          }
        },
        {
          id: 'main-action',
          type: 'custom',
          position: { x: 200, y: 250 },
          data: {
            id: 'main-action',
            type: 'action',
            label: 'Main Action',
            position: { x: 200, y: 250 },
            icon: 'Play',
            color: '#8b5cf6',
            inputs: 1,
            outputs: 2,
            config: {}
          }
        },
        {
          id: 'catch-block',
          type: 'custom',
          position: { x: 400, y: 250 },
          data: {
            id: 'catch-block',
            type: 'catch',
            label: 'Error Handler',
            position: { x: 400, y: 250 },
            icon: 'AlertTriangle',
            color: '#ef4444',
            inputs: 1,
            outputs: 1,
            config: {
              logErrors: true,
              alertOnError: true
            }
          }
        },
        {
          id: 'success-action',
          type: 'custom',
          position: { x: 200, y: 400 },
          data: {
            id: 'success-action',
            type: 'action',
            label: 'Success Action',
            position: { x: 200, y: 400 },
            icon: 'CheckCircle',
            color: '#10b981',
            inputs: 1,
            outputs: 1,
            config: {}
          }
        }
      ],
      edges: [
        {
          id: 'try-main',
          source: 'try-block',
          target: 'main-action',
          style: { stroke: '#3b82f6', strokeWidth: 2 }
        },
        {
          id: 'main-success',
          source: 'main-action',
          target: 'success-action',
          style: { stroke: '#10b981', strokeWidth: 2 },
          data: { condition: 'SUCCESS' }
        },
        {
          id: 'main-error',
          source: 'main-action',
          target: 'catch-block',
          style: { stroke: '#ef4444', strokeWidth: 2 },
          data: { condition: 'ERROR' }
        }
      ]
    }
  },
  {
    id: 'rate-limiter',
    name: 'Rate Limiter',
    description: 'Control the rate of execution',
    icon: Timer,
    category: 'advanced',
    template: {
      nodes: [
        {
          id: 'rate-limiter',
          type: 'custom',
          position: { x: 200, y: 100 },
          data: {
            id: 'rate-limiter',
            type: 'rate-limiter',
            label: 'Rate Limiter',
            position: { x: 200, y: 100 },
            icon: 'Timer',
            color: '#f59e0b',
            inputs: 1,
            outputs: 2,
            config: {
              maxRequests: 10,
              timeWindow: 60000,
              strategy: 'sliding-window'
            }
          }
        },
        {
          id: 'throttled-action',
          type: 'custom',
          position: { x: 200, y: 250 },
          data: {
            id: 'throttled-action',
            type: 'action',
            label: 'Throttled Action',
            position: { x: 200, y: 250 },
            icon: 'Play',
            color: '#10b981',
            inputs: 1,
            outputs: 1,
            config: {}
          }
        },
        {
          id: 'rate-exceeded',
          type: 'custom',
          position: { x: 400, y: 250 },
          data: {
            id: 'rate-exceeded',
            type: 'action',
            label: 'Rate Exceeded',
            position: { x: 400, y: 250 },
            icon: 'AlertCircle',
            color: '#ef4444',
            inputs: 1,
            outputs: 1,
            config: {}
          }
        }
      ],
      edges: [
        {
          id: 'limiter-action',
          source: 'rate-limiter',
          target: 'throttled-action',
          style: { stroke: '#10b981', strokeWidth: 2 },
          data: { condition: 'ALLOWED' }
        },
        {
          id: 'limiter-exceeded',
          source: 'rate-limiter',
          target: 'rate-exceeded',
          style: { stroke: '#ef4444', strokeWidth: 2 },
          data: { condition: 'RATE EXCEEDED' }
        }
      ]
    }
  }
];

export const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All Categories' },
  { value: 'conditional', label: 'Conditional' },
  { value: 'loop', label: 'Loops' },
  { value: 'parallel', label: 'Parallel' },
  { value: 'router', label: 'Routers' },
  { value: 'advanced', label: 'Advanced' }
];

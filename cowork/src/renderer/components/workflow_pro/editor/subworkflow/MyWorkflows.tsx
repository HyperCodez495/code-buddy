import React from 'react';
import { Plus, Settings, GitCommit } from 'lucide-react';
import type { MyWorkflowsProps } from './types';

export const MyWorkflows: React.FC<MyWorkflowsProps> = ({
  subWorkflows,
  performance,
  currentUser,
  onCreateNew
}) => {
  const mySubWorkflows = subWorkflows.filter(sw => sw.createdBy === currentUser);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">My Sub-workflows</h3>
        <button
          onClick={onCreateNew}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create New
        </button>
      </div>

      <div className="space-y-3">
        {mySubWorkflows.map(subWorkflow => (
          <div key={subWorkflow.id} className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <h4 className="font-medium">{subWorkflow.name}</h4>
                <span className="text-sm text-gray-500">v{subWorkflow.version}</span>
                {!subWorkflow.isPublished && (
                  <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                    Draft
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button className="p-2 text-gray-600 hover:bg-gray-100 rounded">
                  <Settings className="w-4 h-4" />
                </button>
                <button className="p-2 text-blue-600 hover:bg-blue-50 rounded">
                  <GitCommit className="w-4 h-4" />
                </button>
              </div>
            </div>

            {performance && (
              <div className="grid grid-cols-4 gap-4 mt-3 text-sm">
                <div>
                  <div className="text-gray-600">Avg Execution</div>
                  <div className="font-medium">
                    {(performance.metrics.avgExecutionTime / 1000).toFixed(2)}s
                  </div>
                </div>
                <div>
                  <div className="text-gray-600">Success Rate</div>
                  <div className="font-medium text-green-600">
                    {performance.metrics.successRate.toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-gray-600">Throughput</div>
                  <div className="font-medium">
                    {performance.metrics.throughput.toFixed(1)}/min
                  </div>
                </div>
                <div>
                  <div className="text-gray-600">Error Rate</div>
                  <div className="font-medium text-red-600">
                    {performance.metrics.errorRate.toFixed(1)}%
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default MyWorkflows;

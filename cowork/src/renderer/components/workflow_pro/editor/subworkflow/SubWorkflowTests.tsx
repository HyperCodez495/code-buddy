import React from 'react';
import { Plus, Play, Check, X, TestTube } from 'lucide-react';
import type { SubWorkflowTestsProps } from './types';

export const SubWorkflowTests: React.FC<SubWorkflowTestsProps> = ({
  tests,
  testResults,
  selectedSubWorkflow,
  onRunTest,
  onCreateTest
}) => {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Tests</h3>
        <button
          onClick={onCreateTest}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create Test
        </button>
      </div>

      {selectedSubWorkflow && tests.length === 0 ? (
        <div className="bg-gray-50 border rounded-lg p-8 text-center">
          <TestTube className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p className="text-gray-600">No tests created yet</p>
          <p className="text-sm text-gray-500 mt-2">
            Create tests to ensure your sub-workflow works correctly
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tests.map(test => {
            const result = testResults.get(test.id);
            return (
              <div key={test.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">{test.name}</h4>
                  <button
                    onClick={() => onRunTest(test)}
                    className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 flex items-center gap-2"
                  >
                    <Play className="w-3 h-3" />
                    Run Test
                  </button>
                </div>

                {test.description && (
                  <p className="text-sm text-gray-600 mb-2">{test.description}</p>
                )}

                <div className="text-sm text-gray-500">
                  {test.testCases.length} test cases
                </div>

                {result && (
                  <div className={`mt-3 p-3 rounded-lg ${
                    result.status === 'passed' ? 'bg-green-50' : 'bg-red-50'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {result.status === 'passed' ? (
                          <Check className="w-4 h-4 text-green-600" />
                        ) : (
                          <X className="w-4 h-4 text-red-600" />
                        )}
                        <span className={`font-medium ${
                          result.status === 'passed' ? 'text-green-700' : 'text-red-700'
                        }`}>
                          {result.status === 'passed' ? 'All tests passed' : 'Tests failed'}
                        </span>
                      </div>
                      <span className="text-sm text-gray-600">
                        {(result.duration / 1000).toFixed(2)}s
                      </span>
                    </div>

                    {result.coverage && (
                      <div className="grid grid-cols-3 gap-2 mt-2 text-sm">
                        <div>Nodes: {result.coverage.nodes}%</div>
                        <div>Edges: {result.coverage.edges}%</div>
                        <div>Branches: {result.coverage.branches}%</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SubWorkflowTests;

import React from 'react';
import { GitBranch, Play, Package, TestTube } from 'lucide-react';

// Import extracted components
import { useSubWorkflow } from './subworkflow/useSubWorkflow';
import { SubWorkflowList } from './subworkflow/SubWorkflowList';
import { SubWorkflowEditor } from './subworkflow/SubWorkflowEditor';
import { SubWorkflowExecutions } from './subworkflow/SubWorkflowExecutions';
import { SubWorkflowTests } from './subworkflow/SubWorkflowTests';
import { MyWorkflows } from './subworkflow/MyWorkflows';
import type { SubWorkflowManagerProps, ActiveTab } from './subworkflow/types';

const TAB_CONFIG: { id: ActiveTab; icon: React.ReactNode; label: string }[] = [
  { id: 'library', icon: <Package className="w-4 h-4 inline mr-2" />, label: 'Library' },
  { id: 'my-workflows', icon: <GitBranch className="w-4 h-4 inline mr-2" />, label: 'My Workflows' },
  { id: 'executions', icon: <Play className="w-4 h-4 inline mr-2" />, label: 'Executions' },
  { id: 'tests', icon: <TestTube className="w-4 h-4 inline mr-2" />, label: 'Tests' }
];

export const SubWorkflowManager: React.FC<SubWorkflowManagerProps> = ({
  workflowId,
  onSubWorkflowSelect: _onSubWorkflowSelect,
  onInsertSubWorkflow
}) => {
  const {
    // State
    activeTab,
    subWorkflows,
    filteredSubWorkflows,
    executions,
    selectedSubWorkflow,
    performance,
    tests,
    searchTerm,
    filterCategory,
    showCreateModal,
    showTestModal,
    testResults,
    expandedWorkflows,
    formData,
    currentUser,

    // Setters
    setActiveTab,
    setSelectedSubWorkflow,
    setSearchTerm,
    setFilterCategory,
    setShowCreateModal,
    setShowTestModal,
    updateFormData,

    // Actions
    handleCreateSubWorkflow,
    handleExecuteSubWorkflow,
    handleRunTest,
    handlePublish,
    toggleWorkflowExpanded
  } = useSubWorkflow(workflowId);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'library':
        return (
          <SubWorkflowList
            subWorkflows={filteredSubWorkflows}
            searchTerm={searchTerm}
            filterCategory={filterCategory}
            expandedWorkflows={expandedWorkflows}
            onSearchChange={setSearchTerm}
            onFilterChange={setFilterCategory}
            onSelect={setSelectedSubWorkflow}
            onExecute={handleExecuteSubWorkflow}
            onInsert={onInsertSubWorkflow}
            onToggleExpand={toggleWorkflowExpanded}
            onPublish={handlePublish}
            onCreateNew={() => setShowCreateModal(true)}
          />
        );

      case 'my-workflows':
        return (
          <MyWorkflows
            subWorkflows={subWorkflows}
            performance={performance}
            currentUser={currentUser}
            onCreateNew={() => setShowCreateModal(true)}
          />
        );

      case 'executions':
        return (
          <SubWorkflowExecutions
            executions={executions}
            subWorkflows={subWorkflows}
          />
        );

      case 'tests':
        return (
          <SubWorkflowTests
            tests={tests}
            testResults={testResults}
            selectedSubWorkflow={selectedSubWorkflow}
            onRunTest={handleRunTest}
            onCreateTest={() => setShowTestModal(true)}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Sub-workflows</h2>
          <p className="text-gray-600">Create and manage reusable workflow components</p>
        </div>

        <div className="mb-6">
          <div className="flex gap-2 bg-white p-2 rounded-lg shadow-sm">
            {TAB_CONFIG.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded ${
                  activeTab === tab.id
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          {renderTabContent()}
        </div>
      </div>

      <SubWorkflowEditor
        isOpen={showCreateModal}
        formData={formData}
        onFormChange={updateFormData}
        onSubmit={handleCreateSubWorkflow}
        onClose={() => setShowCreateModal(false)}
      />

      {/* Test modal placeholder - can be extracted to a separate component if needed */}
      {showTestModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-semibold mb-4">Create Test</h3>
            <p className="text-gray-600 mb-4">Test creation form coming soon...</p>
            <div className="flex justify-end">
              <button
                onClick={() => setShowTestModal(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubWorkflowManager;

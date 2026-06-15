/**
 * StatusIndicator Component
 * Shows execution status in the editor
 */

import React from 'react';
import { Panel } from '@xyflow/react';

interface StatusIndicatorProps {
  isExecuting: boolean;
  darkMode: boolean;
}

const StatusIndicatorComponent: React.FC<StatusIndicatorProps> = ({ isExecuting, darkMode }) => {
  return (
    <Panel position="top-left" className="mt-20">
      <div className={`${
        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      } rounded-lg shadow-xl px-4 py-2 border transition-colors duration-300`}>
        <div className="flex items-center space-x-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isExecuting ? 'bg-blue-500 animate-pulse' : 'bg-green-500'
            }`}
            aria-label={isExecuting ? 'Workflow en cours d\'exécution' : 'Workflow prêt'}
          />
          <span className="text-sm font-medium">
            {isExecuting ? 'Exécution...' : 'Prêt'}
          </span>
        </div>
      </div>
    </Panel>
  );
};

export const StatusIndicator = React.memo(StatusIndicatorComponent);

export default StatusIndicator;

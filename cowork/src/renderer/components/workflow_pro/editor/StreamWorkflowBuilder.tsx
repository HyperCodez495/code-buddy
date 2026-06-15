/**
 * Stream Workflow Builder
 *
 * Visual builder for creating stream processing pipelines:
 * - Drag-and-drop stream components
 * - Configure sources, processors, and sinks
 * - Visual topology view
 * - Real-time validation
 */

import React, { useState, useCallback } from 'react';
import {
  StreamPipeline,
  StreamProcessor,
  StreamConfig,
  WindowConfig,
  AggregationConfig,
  StreamPlatform,
} from '../../../types/streaming';

interface StreamWorkflowBuilderProps {
  onSave?: (pipeline: StreamPipeline) => void;
  initialPipeline?: StreamPipeline;
}

export const StreamWorkflowBuilder: React.FC<StreamWorkflowBuilderProps> = ({
  onSave,
  initialPipeline,
}) => {
  const [pipeline, setPipeline] = useState<StreamPipeline>(
    initialPipeline || {
      id: `pipeline-${Date.now()}`,
      name: 'New Stream Pipeline',
      source: {
        type: 'stream',
        config: {
          platform: 'kafka',
          connectionConfig: {
            brokers: ['localhost:9092'],
            clientId: 'workflow-client',
          },
          consumerConfig: {
            groupId: 'workflow-group',
            topics: ['events'],
          },
        } as StreamConfig,
      },
      processors: [],
      parallelism: 1,
      state: 'created',
    }
  );

  const [selectedPlatform, setSelectedPlatform] = useState<StreamPlatform>('kafka');
  const [showConfig, setShowConfig] = useState(false);

  const addProcessor = useCallback((type: StreamProcessor['type']) => {
    let config;
    if (type === 'window') {
      config = { type: 'tumbling', size: 60000 } as WindowConfig;
    } else if (type === 'aggregate') {
      config = { type: 'count' } as AggregationConfig;
    } else if (type === 'filter') {
      config = { field: '', operator: 'equals', value: '' } as any;
    } else if (type === 'transform') {
      config = { script: '' } as any;
    } else if (type === 'join') {
      config = { leftStream: '', rightStream: '', joinType: 'inner', onFields: [] } as any;
    } else {
      config = { patterns: [] } as any;
    }

    const processor: StreamProcessor = {
      id: `processor-${Date.now()}`,
      type,
      config,
    };

    setPipeline((prev) => ({
      ...prev,
      processors: [...prev.processors, processor],
    }));
  }, []);

  const removeProcessor = useCallback((id: string) => {
    setPipeline((prev) => ({
      ...prev,
      processors: prev.processors.filter((p) => p.id !== id),
    }));
  }, []);

  const handleSave = useCallback(() => {
    onSave?.(pipeline);
  }, [pipeline, onSave]);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Stream Pipeline Builder</h2>
            <p className="text-sm text-gray-500 mt-1">
              Design and configure your event streaming pipeline
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              {showConfig ? 'Hide' : 'Show'} Config
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Save Pipeline
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Components */}
        <div className="w-64 bg-white border-r p-4 overflow-y-auto">
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Source Platform</h3>
            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value as StreamPlatform)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="kafka">Apache Kafka</option>
              <option value="pulsar">Apache Pulsar</option>
              <option value="kinesis">Amazon Kinesis</option>
              <option value="pubsub">Google Pub/Sub</option>
              <option value="eventhubs">Azure Event Hubs</option>
              <option value="redis">Redis Streams</option>
              <option value="nats">NATS Streaming</option>
            </select>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Processors</h3>
            <div className="space-y-2">
              {['window', 'aggregate', 'transform', 'filter', 'join', 'cep'].map((type) => (
                <button
                  key={type}
                  onClick={() => addProcessor(type as StreamProcessor['type'])}
                  className="w-full px-3 py-2 text-left border rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors"
                >
                  <div className="font-medium text-sm capitalize">{type}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {type === 'window' && 'Time-based windowing'}
                    {type === 'aggregate' && 'Aggregation functions'}
                    {type === 'transform' && 'Data transformation'}
                    {type === 'filter' && 'Event filtering'}
                    {type === 'join' && 'Stream joining'}
                    {type === 'cep' && 'Pattern matching'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Pipeline Info</h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-gray-500">Processors:</span>
                <span className="ml-2 font-medium">{pipeline.processors.length}</span>
              </div>
              <div>
                <span className="text-gray-500">Parallelism:</span>
                <span className="ml-2 font-medium">{pipeline.parallelism}</span>
              </div>
              <div>
                <span className="text-gray-500">State:</span>
                <span className="ml-2 font-medium capitalize">{pipeline.state}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Panel - Pipeline View */}
        <div className="flex-1 p-6 overflow-auto">
          <div className="max-w-4xl mx-auto">
            {/* Source */}
            <div className="bg-white rounded-lg border-2 border-blue-500 p-6 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-blue-600 mb-1">SOURCE</div>
                  <div className="text-lg font-medium capitalize">{selectedPlatform}</div>
                  <div className="text-sm text-gray-500 mt-1">
                    Event stream source
                  </div>
                </div>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Processors */}
            {pipeline.processors.map((processor, index) => (
              <div key={processor.id}>
                <div className="flex justify-center my-2">
                  <div className="w-px h-8 bg-gray-300"></div>
                </div>
                <div className="bg-white rounded-lg border-2 border-purple-500 p-6 mb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-purple-600 mb-1">
                        PROCESSOR #{index + 1}
                      </div>
                      <div className="text-lg font-medium capitalize">{processor.type}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        {processor.type === 'window' && 'Time-based windowing'}
                        {processor.type === 'aggregate' && 'Aggregation operations'}
                        {processor.type === 'transform' && 'Data transformation'}
                        {processor.type === 'filter' && 'Event filtering'}
                        {processor.type === 'join' && 'Stream joining'}
                        {processor.type === 'cep' && 'Complex event processing'}
                      </div>
                    </div>
                    <button
                      onClick={() => removeProcessor(processor.id)}
                      className="ml-4 p-2 text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Sink (if configured) */}
            {pipeline.sink && (
              <>
                <div className="flex justify-center my-2">
                  <div className="w-px h-8 bg-gray-300"></div>
                </div>
                <div className="bg-white rounded-lg border-2 border-green-500 p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-green-600 mb-1">SINK</div>
                      <div className="text-lg font-medium capitalize">{pipeline.sink.type}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        Output destination
                      </div>
                    </div>
                    <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                      <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Panel - Configuration */}
        {showConfig && (
          <div className="w-96 bg-white border-l p-6 overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Pipeline Configuration</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Pipeline Name
                </label>
                <input
                  type="text"
                  value={pipeline.name}
                  onChange={(e) => setPipeline({ ...pipeline, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Parallelism
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={pipeline.parallelism}
                  onChange={(e) => setPipeline({ ...pipeline, parallelism: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Error Handling
                </label>
                <select className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                  <option value="retry">Retry</option>
                  <option value="dlq">Dead Letter Queue</option>
                  <option value="skip">Skip</option>
                  <option value="fail">Fail</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Checkpoint Interval (ms)
                </label>
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  defaultValue="60000"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="mt-6 pt-6 border-t">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Pipeline JSON</h4>
              <pre className="bg-gray-50 p-4 rounded-lg text-xs overflow-auto max-h-96">
                {JSON.stringify(pipeline, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StreamWorkflowBuilder;

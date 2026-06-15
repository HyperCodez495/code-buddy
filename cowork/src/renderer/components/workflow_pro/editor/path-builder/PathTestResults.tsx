/**
 * PathTestResults Component
 * Displays test execution results
 */

import React from 'react';
import type { SimulationResult } from './types';

interface PathTestResultsProps {
  results: SimulationResult | null;
  onClose?: () => void;
}

export const PathTestResults: React.FC<PathTestResultsProps> = ({
  results,
  onClose,
}) => {
  if (!results) {
    return null;
  }

  const { success, executionTime, coverage, assertionResults, scenario } = results;

  return (
    <div
      className="test-results-panel"
      style={{
        backgroundColor: 'white',
        borderTop: '1px solid #e5e7eb',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: success ? '#d1fae5' : '#fef2f2',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {success ? (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#dc2626"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          )}
          <span
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: success ? '#065f46' : '#991b1b',
            }}
          >
            Test {success ? 'Passed' : 'Failed'}
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#6b7280',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Results content */}
      <div style={{ padding: '16px' }}>
        {/* Summary */}
        <h4
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: '#6b7280',
            marginBottom: '12px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Test Summary
        </h4>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          {/* Scenario */}
          <div
            style={{
              padding: '12px',
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
            }}
          >
            <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>
              Scenario
            </div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#1f2937' }}>
              {scenario.name}
            </div>
          </div>

          {/* Execution time */}
          <div
            style={{
              padding: '12px',
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
            }}
          >
            <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>
              Execution Time
            </div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#1f2937' }}>
              {executionTime}ms
            </div>
          </div>

          {/* Coverage */}
          <div
            style={{
              padding: '12px',
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
            }}
          >
            <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>
              Coverage
            </div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 500,
                color: coverage.percentage >= 80 ? '#10b981' : coverage.percentage >= 50 ? '#f59e0b' : '#dc2626',
              }}
            >
              {coverage.percentage.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Assertions */}
        {assertionResults.length > 0 && (
          <>
            <h4
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#6b7280',
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Assertions ({assertionResults.filter(a => a.passed).length}/{assertionResults.length} passed)
            </h4>

            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: 'none',
              }}
            >
              {assertionResults.map((result, index) => (
                <li
                  key={index}
                  style={{
                    padding: '8px 12px',
                    backgroundColor: result.passed ? '#d1fae5' : '#fef2f2',
                    borderRadius: '6px',
                    marginBottom: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  {result.passed ? (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#dc2626"
                      strokeWidth="2"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: '13px',
                        color: result.passed ? '#065f46' : '#991b1b',
                      }}
                    >
                      {result.assertion.message || `${result.assertion.type} at ${result.assertion.path}`}
                    </div>
                    {!result.passed && result.error && (
                      <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                        {result.error}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Coverage details */}
        <div style={{ marginTop: '16px' }}>
          <h4
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: '#6b7280',
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Coverage Details
          </h4>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '8px',
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: '#f9fafb',
                borderRadius: '6px',
                fontSize: '13px',
              }}
            >
              <span style={{ color: '#6b7280' }}>Nodes executed: </span>
              <span style={{ fontWeight: 500, color: '#1f2937' }}>{coverage.nodes.size}</span>
            </div>
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: '#f9fafb',
                borderRadius: '6px',
                fontSize: '13px',
              }}
            >
              <span style={{ color: '#6b7280' }}>Connections used: </span>
              <span style={{ fontWeight: 500, color: '#1f2937' }}>{coverage.connections.size}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PathTestResults;

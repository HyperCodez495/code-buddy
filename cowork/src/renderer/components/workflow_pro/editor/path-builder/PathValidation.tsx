/**
 * PathValidation Component
 * Displays validation errors and warnings
 */

import React from 'react';
import type { ValidationState } from './types';

interface PathValidationProps {
  validationState: ValidationState | null;
  onDismiss?: () => void;
}

export const PathValidation: React.FC<PathValidationProps> = ({
  validationState,
  onDismiss,
}) => {
  if (!validationState) {
    return null;
  }

  if (validationState.isValid && validationState.warnings.length === 0) {
    return (
      <div
        className="validation-success"
        style={{
          padding: '12px 16px',
          backgroundColor: '#d1fae5',
          borderTop: '1px solid #10b981',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
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
        <span style={{ color: '#065f46', fontSize: '14px', fontWeight: 500 }}>
          Path configuration is valid
        </span>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#065f46',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="validation-panel"
      style={{
        backgroundColor: 'white',
        borderTop: '1px solid #e5e7eb',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: validationState.errors.length > 0 ? '#fef2f2' : '#fffbeb',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke={validationState.errors.length > 0 ? '#dc2626' : '#f59e0b'}
            strokeWidth="2"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: validationState.errors.length > 0 ? '#991b1b' : '#92400e',
            }}
          >
            Validation Issues
          </span>
          <span
            style={{
              fontSize: '12px',
              color: '#6b7280',
            }}
          >
            ({validationState.errors.length} errors, {validationState.warnings.length} warnings)
          </span>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
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

      {/* Errors */}
      {validationState.errors.length > 0 && (
        <div style={{ padding: '12px 16px' }}>
          <h4
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: '#dc2626',
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Errors
          </h4>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
            }}
          >
            {validationState.errors.map((error, index) => (
              <li
                key={index}
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#fef2f2',
                  borderRadius: '6px',
                  marginBottom: '6px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="#dc2626"
                  style={{ flexShrink: 0, marginTop: '2px' }}
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" stroke="white" strokeWidth="2" />
                  <line x1="9" y1="9" x2="15" y2="15" stroke="white" strokeWidth="2" />
                </svg>
                <div>
                  <div style={{ fontSize: '13px', color: '#991b1b' }}>
                    {error.message}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                    Code: {error.code}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {validationState.warnings.length > 0 && (
        <div style={{ padding: '12px 16px', borderTop: validationState.errors.length > 0 ? '1px solid #e5e7eb' : 'none' }}>
          <h4
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: '#f59e0b',
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Warnings
          </h4>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
            }}
          >
            {validationState.warnings.map((warning, index) => (
              <li
                key={index}
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#fffbeb',
                  borderRadius: '6px',
                  marginBottom: '6px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="#f59e0b"
                  style={{ flexShrink: 0, marginTop: '2px' }}
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" stroke="white" strokeWidth="2" />
                  <circle cx="12" cy="17" r="1" fill="white" />
                </svg>
                <div>
                  <div style={{ fontSize: '13px', color: '#92400e' }}>
                    {warning.message}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                    Code: {warning.code}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default PathValidation;

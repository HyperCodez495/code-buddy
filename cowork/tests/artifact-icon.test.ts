import { describe, it, expect } from 'vitest';
import {
  getArtifactDisplayRole,
  getArtifactDisplayRoleLabel,
  getArtifactIconComponent,
  getArtifactIconKey,
} from '../src/renderer/utils/artifact-steps';

describe('getArtifactIconKey', () => {
  it('returns type icon key for known extensions', () => {
    expect(getArtifactIconKey('report.xlsx')).toBe('table');
    expect(getArtifactIconKey('deck.pptx')).toBe('slides');
    expect(getArtifactIconKey('doc.docx')).toBe('doc');
    expect(getArtifactIconKey('readme.md')).toBe('code');
    expect(getArtifactIconKey('script.js')).toBe('code');
    expect(getArtifactIconKey('script.py')).toBe('code');
    expect(getArtifactIconKey('notes.json')).toBe('code');
    expect(getArtifactIconKey('photo.png')).toBe('image');
    expect(getArtifactIconKey('track.mp3')).toBe('audio');
    expect(getArtifactIconKey('clip.mp4')).toBe('video');
    expect(getArtifactIconKey('archive.zip')).toBe('archive');
    expect(getArtifactIconKey('notes.txt')).toBe('text');
  });

  it('returns file icon key for unknown extensions', () => {
    expect(getArtifactIconKey('archive.bin')).toBe('file');
  });
});

describe('getArtifactIconComponent', () => {
  it('maps presentations and documents to visual components', () => {
    expect(getArtifactIconComponent('deck.pptx')).toBe('presentation');
    expect(getArtifactIconComponent('doc.docx')).toBe('document');
  });
});

describe('artifact display role', () => {
  it('marks generated documents and extracted source images distinctly', () => {
    expect(getArtifactDisplayRole({ toolName: 'generate_document' })).toBe('generated');
    expect(getArtifactDisplayRole({
      toolName: 'document',
      toolInput: { operation: 'extract_images' },
    })).toBe('extracted');
    expect(getArtifactDisplayRole(null)).toBe('recent');
    expect(getArtifactDisplayRole({ toolName: 'Write' })).toBe('file');
  });

  it('returns compact labels for artifact roles', () => {
    expect(getArtifactDisplayRoleLabel('generated')).toBe('Generated');
    expect(getArtifactDisplayRoleLabel('extracted')).toBe('Extracted');
    expect(getArtifactDisplayRoleLabel('recent')).toBe('Recent');
    expect(getArtifactDisplayRoleLabel('file')).toBe('File');
  });
});

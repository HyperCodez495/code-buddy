import { describe, it, expect } from 'vitest';
import {
  extractFilePathFromToolInput,
  extractFilePathFromToolOutput,
  extractFilePathsFromToolOutput,
} from '../src/renderer/utils/tool-output-path';

describe('extractFilePathFromToolOutput', () => {
  it('extracts path from File written output', () => {
    const output = 'File written: /Users/haoqing/Desktop/report.docx';
    expect(extractFilePathFromToolOutput(output)).toBe('/Users/haoqing/Desktop/report.docx');
  });

  it('extracts path from File edited output', () => {
    const output = 'File edited: /Users/haoqing/Desktop/report.docx';
    expect(extractFilePathFromToolOutput(output)).toBe('/Users/haoqing/Desktop/report.docx');
  });

  it('extracts path from File created successfully output', () => {
    const output = 'File created successfully at: /Users/haoqing/Desktop/report.docx';
    expect(extractFilePathFromToolOutput(output)).toBe('/Users/haoqing/Desktop/report.docx');
  });

  it('extracts generated document paths from generate_document output', () => {
    const output = 'Created DOCX: D:\\Reports\\atelier-word\\livrable-final.docx';
    expect(extractFilePathFromToolOutput(output)).toBe(
      'D:\\Reports\\atelier-word\\livrable-final.docx'
    );
  });

  it('extracts generated document paths from multiline generate_document output', () => {
    const output = [
      'Created DOCX: D:\\Reports\\atelier-word\\livrable-final.docx',
      'Embedded images:',
      '- D:\\Reports\\atelier-word\\screens\\image1.png (Question 1) [520x310]',
    ].join('\n');
    expect(extractFilePathFromToolOutput(output)).toBe(
      'D:\\Reports\\atelier-word\\livrable-final.docx'
    );
    expect(extractFilePathsFromToolOutput(output)).toEqual([
      'D:\\Reports\\atelier-word\\livrable-final.docx',
      'D:\\Reports\\atelier-word\\screens\\image1.png',
    ]);
  });

  it('extracts DOCX embedded image paths from document extract_images output', () => {
    const output = [
      'Extracted 2 embedded image(s) to D:\\Reports\\atelier-word\\screens',
      '- D:\\Reports\\atelier-word\\screens\\image1.png (9 bytes)',
      '- D:\\Reports\\atelier-word\\screens\\image2.jpeg (10 bytes)',
    ].join('\n');
    expect(extractFilePathFromToolOutput(output)).toBe(
      'D:\\Reports\\atelier-word\\screens\\image1.png'
    );
  });

  it('extracts every DOCX embedded image path from document extract_images output', () => {
    const output = [
      'Extracted 2 embedded image(s) to D:\\Reports\\atelier-word\\screens',
      '- D:\\Reports\\atelier-word\\screens\\image1.png (9 bytes)',
      '- D:\\Reports\\atelier-word\\screens\\image2.jpeg (10 bytes)',
    ].join('\n');
    expect(extractFilePathsFromToolOutput(output)).toEqual([
      'D:\\Reports\\atelier-word\\screens\\image1.png',
      'D:\\Reports\\atelier-word\\screens\\image2.jpeg',
    ]);
  });

  it('extracts DOCX embedded image paths from JSON tool results', () => {
    const output = JSON.stringify({
      data: {
        images: [
          {
            outputPath: 'D:\\Reports\\atelier-word\\screens\\image1.png',
          },
        ],
      },
    });
    expect(extractFilePathFromToolOutput(output)).toBe(
      'D:\\Reports\\atelier-word\\screens\\image1.png'
    );
  });

  it('extracts DOCX embedded image paths from JSON markdown references', () => {
    const output = JSON.stringify({
      data: {
        images: [
          {
            markdownRef: '![Source screenshot - image1.png](D:/Reports/atelier-word/screens/image1.png)',
          },
        ],
      },
    });
    expect(extractFilePathFromToolOutput(output)).toBe(
      'D:/Reports/atelier-word/screens/image1.png'
    );
  });

  it('extracts generated document paths from JSON tool metadata', () => {
    const output = JSON.stringify({
      data: {
        outputPath: 'D:\\Reports\\atelier-word\\livrable-final.docx',
        embeddedImages: [
          {
            path: 'D:\\Reports\\atelier-word\\screens\\image1.png',
          },
        ],
      },
    });
    expect(extractFilePathFromToolOutput(output)).toBe(
      'D:\\Reports\\atelier-word\\livrable-final.docx'
    );
    expect(extractFilePathsFromToolOutput(output)).toEqual([
      'D:\\Reports\\atelier-word\\livrable-final.docx',
      'D:\\Reports\\atelier-word\\screens\\image1.png',
    ]);
  });

  it('extracts generated document paths from JSON tool output text', () => {
    const output = JSON.stringify({
      success: true,
      output: [
        'Created DOCX: D:\\Reports\\atelier-word\\livrable-final.docx',
        'Embedded images:',
        '- D:\\Reports\\atelier-word\\screens\\image1.png (Question 1) [520x310]',
        'DOCX validation:',
        '- relationships: 34',
      ].join('\n'),
    });

    expect(extractFilePathsFromToolOutput(output)).toEqual([
      'D:\\Reports\\atelier-word\\livrable-final.docx',
      'D:\\Reports\\atelier-word\\screens\\image1.png',
    ]);
  });

  it('extracts embedded image paths from JSON tool metadata when no document path exists', () => {
    const output = JSON.stringify({
      data: {
        embeddedImages: [
          {
            path: 'D:\\Reports\\atelier-word\\screens\\image1.png',
          },
        ],
      },
    });
    expect(extractFilePathFromToolOutput(output)).toBe(
      'D:\\Reports\\atelier-word\\screens\\image1.png'
    );
  });

  it('extracts every embedded image path from JSON tool metadata when no document path exists', () => {
    const output = JSON.stringify({
      data: {
        embeddedImages: [
          {
            path: 'D:\\Reports\\atelier-word\\screens\\image1.png',
          },
          {
            path: 'D:\\Reports\\atelier-word\\screens\\image2.png',
          },
        ],
      },
    });
    expect(extractFilePathsFromToolOutput(output)).toEqual([
      'D:\\Reports\\atelier-word\\screens\\image1.png',
      'D:\\Reports\\atelier-word\\screens\\image2.png',
    ]);
  });

  it('extracts path from JSON output', () => {
    const output = JSON.stringify({ filePath: '/tmp/demo.txt' });
    expect(extractFilePathFromToolOutput(output)).toBe('/tmp/demo.txt');
  });

  it('extracts top-level outputPath from JSON output', () => {
    const output = JSON.stringify({ outputPath: 'D:\\Reports\\atelier-word\\livrable.docx' });
    expect(extractFilePathFromToolOutput(output)).toBe('D:\\Reports\\atelier-word\\livrable.docx');
  });

  it('keeps image evidence when JSON has top-level outputPath', () => {
    const output = JSON.stringify({
      outputPath: 'D:\\Reports\\atelier-word\\livrable.docx',
      data: {
        embeddedImages: [
          {
            path: 'D:\\Reports\\atelier-word\\screens\\image1.png',
          },
        ],
      },
    });

    expect(extractFilePathsFromToolOutput(output)).toEqual([
      'D:\\Reports\\atelier-word\\livrable.docx',
      'D:\\Reports\\atelier-word\\screens\\image1.png',
    ]);
  });

  it('keeps image evidence when JSON has top-level path', () => {
    const output = JSON.stringify({
      path: 'D:\\Reports\\atelier-word\\livrable.docx',
      data: {
        embeddedImages: [
          {
            markdownRef: '![Source screenshot](D:/Reports/atelier-word/screens/image1.png)',
          },
        ],
      },
    });

    expect(extractFilePathsFromToolOutput(output)).toEqual([
      'D:\\Reports\\atelier-word\\livrable.docx',
      'D:/Reports/atelier-word/screens/image1.png',
    ]);
  });

  it('keeps image evidence when JSON has top-level filePath', () => {
    const output = JSON.stringify({
      filePath: 'D:\\Reports\\atelier-word\\livrable.docx',
      data: {
        images: [
          {
            outputPath: 'D:\\Reports\\atelier-word\\screens\\image1.png',
          },
        ],
      },
    });

    expect(extractFilePathsFromToolOutput(output)).toEqual([
      'D:\\Reports\\atelier-word\\livrable.docx',
      'D:\\Reports\\atelier-word\\screens\\image1.png',
    ]);
  });

  it('extracts relative path from wrapped write tool output', () => {
    const output = JSON.stringify({
      content: [
        {
          type: 'text',
          text: 'Successfully wrote 2986 bytes to agent_papers_summary.html',
        },
      ],
    });
    expect(extractFilePathFromToolOutput(output)).toBe('agent_papers_summary.html');
  });

  it('extracts absolute path from updated-file messages', () => {
    const output = 'The file /Users/haoqing/Library/Application Support/open-cowork/default_working_dir/slide2.html has been updated successfully.';
    expect(extractFilePathFromToolOutput(output)).toBe('/Users/haoqing/Library/Application Support/open-cowork/default_working_dir/slide2.html');
  });

  it('extracts screenshot path from wrapped screenshot output', () => {
    const output = JSON.stringify({
      content: [
        {
          type: 'text',
          text: 'Took a screenshot of the full current page.\nSaved screenshot to /Users/haoqing/Desktop/open-cowork/agent_papers_summary_screenshot.png.',
        },
      ],
    });
    expect(extractFilePathFromToolOutput(output)).toBe('/Users/haoqing/Desktop/open-cowork/agent_papers_summary_screenshot.png');
  });

  it('returns null for unrelated output', () => {
    expect(extractFilePathFromToolOutput('OK')).toBeNull();
  });
});

describe('extractFilePathFromToolInput', () => {
  it('extracts path from canonical path field', () => {
    expect(extractFilePathFromToolInput({ path: '/tmp/output.txt' })).toBe('/tmp/output.txt');
  });

  it('extracts path from alternate fields', () => {
    expect(extractFilePathFromToolInput({ filePath: '/tmp/a.txt' })).toBe('/tmp/a.txt');
    expect(extractFilePathFromToolInput({ file_path: '/tmp/b.txt' })).toBe('/tmp/b.txt');
    expect(extractFilePathFromToolInput({ relativePath: 'reports/monthly.md' })).toBe('reports/monthly.md');
  });

  it('returns null when input has no path-like keys', () => {
    expect(extractFilePathFromToolInput({ command: 'echo hi' })).toBeNull();
    expect(extractFilePathFromToolInput(undefined)).toBeNull();
  });
});

type ParsedOutput = {
  path?: string;
  filePath?: string;
  outputPath?: string;
  output?: string;
  data?: {
    outputPath?: string;
    images?: Array<{
      outputPath?: string;
      path?: string;
      markdownRef?: string;
    }>;
    embeddedImages?: Array<{
      path?: string;
      markdownRef?: string;
    }>;
  };
  content?: Array<{
    type?: string;
    text?: string;
  }>;
};

type ParsedInput = {
  path?: string;
  filePath?: string;
  file_path?: string;
  relativePath?: string;
};

export function extractFilePathFromToolOutput(toolOutput?: string): string | null {
  return extractFilePathsFromToolOutput(toolOutput)[0] ?? null;
}

export function extractFilePathsFromToolOutput(toolOutput?: string): string[] {
  if (!toolOutput) {
    return [];
  }

  const trimmed = toolOutput.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as ParsedOutput;
    if (parsed && typeof parsed === 'object') {
      const dataPaths: string[] = [];
      if (typeof parsed.filePath === 'string' && parsed.filePath.trim()) {
        dataPaths.push(parsed.filePath.trim());
      }
      if (typeof parsed.path === 'string' && parsed.path.trim()) {
        dataPaths.push(parsed.path.trim());
      }
      if (typeof parsed.outputPath === 'string' && parsed.outputPath.trim()) {
        dataPaths.push(parsed.outputPath.trim());
      }
      if (typeof parsed.data?.outputPath === 'string' && parsed.data.outputPath.trim()) {
        dataPaths.push(parsed.data.outputPath.trim());
      }
      const imageOutputPaths = parsed.data?.images
        ?.map(readPathLikeImageValue)
        .filter((outputPath): outputPath is string => typeof outputPath === 'string' && outputPath.trim().length > 0)
        .map((outputPath) => outputPath.trim()) ?? [];
      dataPaths.push(...imageOutputPaths);
      const embeddedImagePaths = parsed.data?.embeddedImages
        ?.map(readPathLikeImageValue)
        .filter((imagePath): imagePath is string => typeof imagePath === 'string' && imagePath.trim().length > 0)
        .map((imagePath) => imagePath.trim()) ?? [];
      dataPaths.push(...embeddedImagePaths);
      const uniqueDataPaths = uniquePaths(dataPaths);
      if (uniqueDataPaths.length > 0) {
        return uniqueDataPaths;
      }
      if (typeof parsed.output === 'string' && parsed.output.trim()) {
        const outputPaths = extractFilePathsFromText(parsed.output);
        if (outputPaths.length > 0) {
          return outputPaths;
        }
      }
      if (Array.isArray(parsed.content)) {
        const textContent = parsed.content
          .map((item) => (item && typeof item.text === 'string' ? item.text : ''))
          .filter(Boolean)
          .join('\n');
        const nestedPaths = extractFilePathsFromText(textContent);
        if (nestedPaths.length > 0) {
          return nestedPaths;
        }
      }
    }
  } catch {
    // ignore JSON parse failures
  }

  return extractFilePathsFromText(trimmed);
}

export function extractFilePathFromToolInput(
  toolInput?: Record<string, unknown>
): string | null {
  if (!toolInput || typeof toolInput !== 'object') {
    return null;
  }

  const input = toolInput as ParsedInput;
  const candidates = [input.path, input.filePath, input.file_path, input.relativePath];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readPathLikeImageValue(image: {
  outputPath?: string;
  path?: string;
  markdownRef?: string;
}): string | undefined {
  if (typeof image.outputPath === 'string' && image.outputPath.trim()) {
    return image.outputPath;
  }
  if (typeof image.path === 'string' && image.path.trim()) {
    return image.path;
  }
  if (typeof image.markdownRef === 'string' && image.markdownRef.trim()) {
    return extractPathFromMarkdownRef(image.markdownRef);
  }
  return undefined;
}

function extractPathFromMarkdownRef(markdownRef: string): string | undefined {
  const match = markdownRef.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
  return match?.[1]?.trim();
}

function extractFilePathsFromText(text: string): string[] {
  const paths: string[] = [];
  const singleMatch = text.match(/File (?:written|edited):\s*(.+)$/i)
    || text.match(/File created successfully at:?\s*(.+)$/i)
    || text.match(/Created (?:DOCX|PDF|PPTX|XLSX):\s*([^\r\n]+)/i)
    || text.match(/Successfully wrote \d+ bytes to ([^\r\n]+)/i)
    || text.match(/The file (.+?) has been updated(?: successfully)?(?:\.|$)/i)
    || text.match(/Saved screenshot to ([^\r\n]+)/i);

  if (singleMatch?.[1]) {
    paths.push(sanitizeMatchedPath(singleMatch[1]));
  }

  const bulletPattern = /^- (.+?) \(\d+ bytes\)$/gim;
  let bulletMatch: RegExpExecArray | null;
  while ((bulletMatch = bulletPattern.exec(text)) !== null) {
    if (bulletMatch[1]) {
      paths.push(sanitizeMatchedPath(bulletMatch[1]));
    }
  }

  const embeddedImagePattern = /^- (.+?) \(.+?\) \[\d+x\d+\]$/gim;
  let embeddedImageMatch: RegExpExecArray | null;
  while ((embeddedImageMatch = embeddedImagePattern.exec(text)) !== null) {
    if (embeddedImageMatch[1]) {
      paths.push(sanitizeMatchedPath(embeddedImageMatch[1]));
    }
  }

  return uniquePaths(paths);
}

function sanitizeMatchedPath(value: string): string {
  return value.trim().replace(/[.,;:!?]+$/, '');
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const path of paths) {
    const trimmed = path.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

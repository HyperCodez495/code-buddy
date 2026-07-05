export type CsvColumnType = 'number' | 'string' | 'date';

export interface CsvColumnInference {
  index: number;
  name: string;
  type: CsvColumnType;
  nulls: number;
  nonNulls: number;
}

export interface NumericStats {
  count: number;
  nulls: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
}

export function parseCsv(text: string, delimiter = ','): string[][] {
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === '\n' || delimiter === '\r') {
    throw new Error('Delimiter must be a single character other than quote or newline');
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.length > 0) {
        throw new Error(`Malformed CSV: unexpected quote at character ${index}`);
      }
      inQuotes = true;
      fieldWasQuoted = true;
      continue;
    }

    if (char === delimiter) {
      row.push(field);
      field = '';
      fieldWasQuoted = false;
      continue;
    }

    if (char === '\n' || char === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldWasQuoted = false;
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      continue;
    }

    if (fieldWasQuoted && char.trim() !== '') {
      throw new Error(`Malformed CSV: unexpected character after closing quote at character ${index}`);
    }

    field += char;
  }

  if (inQuotes) {
    throw new Error('Malformed CSV: unterminated quoted field');
  }

  if (field.length > 0 || row.length > 0 || text.endsWith(delimiter)) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  const width = rows[0]?.length ?? 0;
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index]?.length !== width) {
      throw new Error(`Malformed CSV: row ${index + 1} has ${rows[index]?.length ?? 0} fields, expected ${width}`);
    }
  }

  return rows;
}

export function inferColumnTypes(rows: string[][]): CsvColumnInference[] {
  const header = rows[0] ?? [];
  const dataRows = rows.slice(1);

  return header.map((name, index) => {
    const values = dataRows.map((row) => row[index] ?? '');
    const nonEmpty = values.map((value) => value.trim()).filter((value) => value.length > 0);
    const nulls = values.length - nonEmpty.length;

    const type: CsvColumnType = nonEmpty.length > 0 && nonEmpty.every(isNumber)
      ? 'number'
      : nonEmpty.length > 0 && nonEmpty.every(isDate)
        ? 'date'
        : 'string';

    return {
      index,
      name: name.trim() || `column_${index + 1}`,
      type,
      nulls,
      nonNulls: nonEmpty.length,
    };
  });
}

export function numericStats(values: string[]): NumericStats {
  const numbers = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && isNumber(value))
    .map(Number)
    .sort((left, right) => left - right);
  const nulls = values.length - numbers.length;

  if (numbers.length === 0) {
    return { count: 0, nulls, min: null, max: null, mean: null, median: null };
  }

  const sum = numbers.reduce((total, value) => total + value, 0);
  const middle = Math.floor(numbers.length / 2);
  const median = numbers.length % 2 === 0
    ? ((numbers[middle - 1] ?? 0) + (numbers[middle] ?? 0)) / 2
    : numbers[middle] ?? null;

  return {
    count: numbers.length,
    nulls,
    min: numbers[0] ?? null,
    max: numbers[numbers.length - 1] ?? null,
    mean: sum / numbers.length,
    median,
  };
}

function isNumber(value: string): boolean {
  return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/iu.test(value.trim()) && Number.isFinite(Number(value));
}

function isDate(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[tT ][\d:.+-]+(?:Z)?)?$/u.test(trimmed)) {
    return false;
  }
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp);
}

import Papa from "papaparse";

export type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
};

export type ParseError = { code: "too_many_rows" | "parse_failed"; message: string };

const MAX_ROWS = 1000;

export function parseIngestCsv(file: File): Promise<ParsedCsv | ParseError> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (result) => {
        if (result.errors.length > 0) {
          resolve({ code: "parse_failed", message: result.errors[0].message });
          return;
        }
        const rows = result.data;
        if (rows.length > MAX_ROWS) {
          resolve({
            code: "too_many_rows",
            message: `${rows.length} rows exceeds the ${MAX_ROWS}-row per-upload limit. Split the file.`,
          });
          return;
        }
        const headers = result.meta.fields ?? [];
        resolve({ headers, rows });
      },
      error: (err) => resolve({ code: "parse_failed", message: err.message }),
    });
  });
}

export function escapeCsv(value: string | number | null) {
  let text = String(value ?? "");
  // CSV quoting alone does not prevent spreadsheet formula execution.
  // Preserve true numeric values, including negative premium adjustments.
  if (typeof value === "string" && (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

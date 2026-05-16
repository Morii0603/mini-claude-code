/** Normalize curly/smart quotes to straight quotes. */
export function normalizeQuotes(s: string): string {
  return s
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"');
}

/** Find the actual string in content, handling quote normalization. */
export function findActualString(
  fileContent: string,
  searchString: string,
): string | undefined {
  if (fileContent.includes(searchString)) return searchString;

  const normSearch = normalizeQuotes(searchString);
  const normFile = normalizeQuotes(fileContent);
  const idx = normFile.indexOf(normSearch);
  if (idx !== -1) {
    return fileContent.slice(idx, idx + searchString.length);
  }
  return undefined;
}

/** Generate a unified-diff-like string for an edit. */
export function generateDiff(
  oldContent: string,
  oldString: string,
  newString: string,
): string {
  const beforeChange = oldContent.split(oldString)[0] as string;
  const lineNum = beforeChange.split("\n").length;
  const oldLines = oldString.split("\n");
  const newLines = newString.split("\n");

  const parts: string[] = [
    `@@ -${lineNum},${oldLines.length} +${lineNum},${newLines.length} @@`,
  ];
  for (const l of oldLines) parts.push(`- ${l}`);
  for (const l of newLines) parts.push(`+ ${l}`);
  return parts.join("\n");
}

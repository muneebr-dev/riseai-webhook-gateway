/** Parse KEY=value lines (blank lines and # comments skipped, quotes stripped). */
export const parseEnvFile = (contents: string): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    values[key] = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
  return values;
};

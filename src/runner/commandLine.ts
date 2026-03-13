export type CommandPrefix = readonly string[];
export type CommandPrefixList = readonly CommandPrefix[];

export function parseCommandLine(value = ""): string[] {
  const matches = String(value).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((part) => part.replace(/^['"]|['"]$/g, ""));
}

export function hasForbiddenShellSyntax(value = ""): boolean {
  const raw = String(value);
  return /[;&|<>`]/.test(raw) || /\$\(/.test(raw) || /[\r\n]/.test(raw);
}

export function matchesAllowedCommandPrefix(
  argv: readonly string[] | null | undefined,
  allowedPrefixes: CommandPrefixList
): boolean {
  if (!Array.isArray(argv) || !argv.length) return false;

  return allowedPrefixes.some((prefix) => {
    if (
      !Array.isArray(prefix) ||
      !prefix.length ||
      prefix.length > argv.length
    ) {
      return false;
    }

    return prefix.every((token, index) => argv[index] === token);
  });
}

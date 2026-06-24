/** CLI arg helpers shared across commands. */

/** Value following a --flag in `args`, or undefined. */
export function flag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

// The name an experiment is shown under: a rename sets `DefinitionRecord.displayName` and never
// edits the (content-addressed) definition. Works on records and on loaded run data alike.
export function experimentName(x: {
  displayName?: string | undefined;
  definition: { name: string };
}): string {
  return x.displayName ?? x.definition.name;
}

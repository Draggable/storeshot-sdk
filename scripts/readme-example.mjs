// SS-018 D8: the README's main example (the ```ts block after `<!-- sdk-readme-example -->`).
// Shared by the unit test (typechecks it) and the stack test (runs it against a test-mode server).
export const MARKER = '<!-- sdk-readme-example -->';

export function extractReadmeExample(markdown) {
  const lines = markdown.split('\n');
  const markers = lines.flatMap((line, i) => (line.trim() === MARKER ? [i] : []));
  if (markers.length !== 1)
    throw new Error(`README: expected one ${MARKER}, found ${markers.length}`);
  let i = markers[0] + 1;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (lines[i] !== '```ts')
    throw new Error(`README: ${MARKER} must be followed by a \`\`\`ts block`);
  const start = i + 1;
  const end = lines.indexOf('```', start);
  if (end < 0) throw new Error('README: the example block is not closed');
  return { code: `${lines.slice(start, end).join('\n')}\n`, line: start + 1 };
}

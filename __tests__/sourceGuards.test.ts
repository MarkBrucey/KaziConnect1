// Checks on the website's source. There is no browser in the test run, so these guard the two rules the
// Event work page depends on: text that came from Sherehe or the API is only ever shown as text (React
// escapes it), and the county list is the shared one (requirement R5).

import fs from 'fs';
import path from 'path';
import { COUNTIES } from '../sharedLists';

const root = path.join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'api' ? [] : sourceFiles(relative);
    return /\.(tsx?|jsx?)$/.test(entry.name) ? [relative] : [];
  });
}
const websiteFiles = [...sourceFiles('app'), ...sourceFiles('components'), ...sourceFiles('lib')];
const read = (file: string): string => fs.readFileSync(path.join(root, file), 'utf8');

// The text between the braces of every `attribute={...}` that `opening` finds, brackets matched.
function attributeValues(source: string, opening: RegExp): string[] {
  return [...source.matchAll(opening)].map((match) => {
    let depth = 1;
    let end = match.index! + match[0].length;
    for (; end < source.length && depth > 0; end++) {
      if (source[end] === '{') depth++;
      if (source[end] === '}') depth--;
    }
    return source.slice(match.index! + match[0].length, end - 1).trim();
  });
}

describe('the website source', () => {
  it('finds the pages this test looks at (so the checks below cannot pass by finding nothing)', () => {
    expect(websiteFiles.length).toBeGreaterThan(30);
    expect(websiteFiles).toContain(path.join('components', 'EventWork.tsx'));
    expect(websiteFiles).toContain(path.join('app', 'page.tsx'));
  });

  it.each(['dangerouslySetInnerHTML', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function('])(
    'never uses %s, which would let text from Sherehe or the API be read as markup',
    (sink) => {
      const using = websiteFiles.filter((file) => read(file).includes(sink));
      expect(using).toEqual([]);
    },
  );

  it('only ever links to paths inside the site, never to an address that came from the API', () => {
    const links = websiteFiles.flatMap((file) => attributeValues(read(file), /\b(?:href|src)=\{/g).map((value) => `${file}: ${value}`));
    expect(links.length).toBeGreaterThan(0);
    // A path that starts with a slash, written out in the source ('/x' or `/x/${id}`), is inside the site.
    const outside = links.filter((link) => !/: (?:`\/|'\/)/.test(link));
    expect(outside).toEqual([]);
  });

  it('offers the shared list of 47 counties on the Event work page, in the same order (requirement R5)', () => {
    expect(COUNTIES).toHaveLength(47);
    const page = read(path.join('components', 'EventWork.tsx'));
    expect(page).toContain("import { COUNTIES } from '@/sharedLists'");
    expect(page).toMatch(/COUNTIES\.map\(/);
    expect(page).not.toMatch(/KENYA_COUNTIES|\['Nairobi', ?'Mombasa'/);
  });
});

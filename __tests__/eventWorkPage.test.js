// The Event work page in index.html. These are checks on the file itself; the page is a single
// static file with no build step, and there is no browser in the test run.

const fs = require('fs');
const path = require('path');
const { COUNTIES } = require('../sharedLists');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// The part of the page's script that shows Sherehe's data.
const START = '// Event work: open roles on upcoming events';
const END = 'function openPostJob()';
const eventWorkScript = html.slice(html.indexOf(START), html.indexOf(END));

// Removes every esc(...), Number(...) and num(...) call, brackets matched, from an expression.
function withoutSafeCalls(expression) {
  let text = expression;
  for (const name of ['esc', 'Number', 'num']) {
    let at = text.indexOf(`${name}(`);
    while (at !== -1) {
      let depth = 0;
      let end = at + name.length;
      for (; end < text.length; end++) {
        if (text[end] === '(') depth++;
        if (text[end] === ')' && --depth === 0) break;
      }
      text = text.slice(0, at) + text.slice(end + 1);
      at = text.indexOf(`${name}(`);
    }
  }
  return text;
}

describe('the Event work page', () => {
  it('offers exactly the shared list of 47 counties, in the same order (requirement R5)', () => {
    const literal = /const KENYA_COUNTIES = (\[[^\]]*\]);/.exec(html);

    expect(literal).not.toBeNull();
    const inPage = Function(`return ${literal[1]}`)();
    expect(inPage).toHaveLength(47);
    expect(inPage).toEqual(COUNTIES);
  });

  it('has the Event work code this test looks at (so the check below cannot pass by finding nothing)', () => {
    expect(eventWorkScript.length).toBeGreaterThan(2000);
    expect(eventWorkScript).toContain('function openingCard(');
    expect(eventWorkScript).toContain('function offerCard(');
  });

  it('never puts text that came from Sherehe or the API into the page without esc(), Number() or num()', () => {
    // Left out, because none of them can put markup on the page:
    //   evMessage(`...`)   writes the message with textContent, which the browser never parses as HTML
    //   a ternary that only compares a value with a fixed word and answers with fixed text
    //   .map(openingCard) / .map(offerCard) joins cards that are built with esc() themselves
    const checked = eventWorkScript.replace(/evMessage\(`[^`]*`\);/g, '');
    const expressions = [...checked.matchAll(/\$\{([^{}`]*)\}/g)].map((m) => m[1]);
    expect(expressions.length).toBeGreaterThan(20);

    const unsafe = expressions
      .filter((e) => !/^[os]\.\w+ === '[a-z]+' \? '[^']*' : ''$/.test(e))
      .filter((e) => !/^[\w.]+\.map\((openingCard|offerCard)\)\.join\(''\)$/.test(e))
      .filter((e) => /\b(o|s|res|x)\.\w/.test(withoutSafeCalls(e)));

    expect(unsafe).toEqual([]);
  });

  it('keeps the dashboard tabs off the .chip class, because the job filters rewrite aria-pressed on every .chip', () => {
    const tabs = [...html.matchAll(/<button[^>]*data-dash-tab="[a-z]+"[^>]*>/g)].map((m) => m[0]);

    expect(tabs).toHaveLength(2);
    tabs.forEach((tag) => expect(tag).not.toMatch(/class="[^"]*\bchip\b/));
  });

  it('has the panels, picker and dialog the script looks up', () => {
    ['panel-jobs', 'panel-events', 'ev-county', 'ev-openings', 'ev-offers', 'ev-message', 'offer-dialog'].forEach((id) => {
      expect(html).toContain(`id="${id}"`);
    });
  });
});

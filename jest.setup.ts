// Next.js loads next.config.ts with a plain import, but inside Jest's sandbox that hands back an
// object from another realm which Next then cannot copy. This is Next's own switch for running
// under Jest: it loads the config through Jest's require instead.
process.env.__NEXT_TEST_MODE = 'jest';

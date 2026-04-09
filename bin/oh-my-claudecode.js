#!/usr/bin/env node
import('../dist/cli/index.js').catch((err) => {
  console.error('oh-my-claudecode: failed to load CLI', err.message);
  process.exit(1);
});

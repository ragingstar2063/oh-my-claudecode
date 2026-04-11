#!/usr/bin/env node
import('../dist/mcp/yith-server.js').catch((err) => {
  console.error('yith-mcp: failed to load server', err.message);
  process.exit(1);
});

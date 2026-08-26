import { runMcpServer } from './mcp/server.js';

runMcpServer().catch((error) => {
  process.stderr.write(`Fatal error starting MCP server: ${error.stack || error.message}\n`);
  process.exit(1);
});

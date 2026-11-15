// Kvant fork: bundles the MCP server (mcp/server.js with the MCP SDK and zod) into
// mcp/dist/server.js, which the .vsix carries and the extension registers with the
// editor. pdf.js stays external: the .vsix already ships its legacy build.
"use strict";

const path = require("node:path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");

esbuild.buildSync({
  entryPoints: [path.join(root, "mcp", "server.js")],
  outfile: path.join(root, "mcp", "dist", "server.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["pdfjs-dist", "pdfjs-dist/*"],
  legalComments: "external",
});

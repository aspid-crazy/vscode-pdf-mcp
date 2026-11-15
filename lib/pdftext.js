// @ts-check
/**
 * Kvant fork: PDF content for the MCP server — document info, page text and search —
 * read with the same pdf.js the viewer ships (legacy build, runs in plain Node).
 */
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

/** Pages one read_pdf_text call returns when the caller sets no end page. */
const DEFAULT_PAGE_SPAN = 20;

/** @type {Promise<any> | null} */
let pdfjsPromise = null;
function pdfjs() {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

/** @param {string} file */
async function open(file) {
  if (!path.isAbsolute(file)) throw new Error(`path must be absolute: ${file}`);
  const lib = await pdfjs();
  const data = new Uint8Array(await fs.readFile(file));
  // verbosity 0: pdf.js prints warnings with console.log, and stdout belongs to MCP.
  return lib.getDocument({ data, verbosity: 0, isEvalSupported: false, disableFontFace: true }).promise;
}

/** @param {any} doc @param {number} n 1-based */
async function pageText(doc, n) {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  let text = "";
  for (const item of content.items) {
    if (typeof item.str !== "string") continue;
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  page.cleanup();
  return text.replace(/[ \t]+\n/g, "\n").trim();
}

/** @param {any} doc @param {any[] | null} items @param {number} depth */
async function outline(doc, items, depth = 0) {
  /** @type {{title: string, page: number | null, depth: number}[]} */
  const out = [];
  for (const item of items || []) {
    let page = null;
    try {
      const dest = typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
      if (Array.isArray(dest) && dest[0]) page = (await doc.getPageIndex(dest[0])) + 1;
    } catch {
      // an outline entry without a resolvable destination keeps page: null
    }
    out.push({ title: item.title, page, depth });
    out.push(...(await outline(doc, item.items, depth + 1)));
  }
  return out;
}

/** @param {string} file */
async function info(file) {
  const doc = await open(file);
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const i = /** @type {Record<string, unknown>} */ (meta?.info ?? {});
    return {
      path: file,
      pages: doc.numPages,
      title: i.Title || null,
      author: i.Author || null,
      subject: i.Subject || null,
      producer: i.Producer || null,
      created: i.CreationDate || null,
      outline: await outline(doc, await doc.getOutline()),
    };
  } finally {
    await doc.destroy();
  }
}

/**
 * Text of pages `from`..`to` (1-based, inclusive). Without `to`, DEFAULT_PAGE_SPAN pages;
 * `next_page` says where the following call starts, null when the document ended.
 * @param {string} file @param {number} [from] @param {number} [to]
 */
async function readText(file, from = 1, to) {
  const doc = await open(file);
  try {
    const last = doc.numPages;
    if (from < 1 || from > last) throw new Error(`from_page ${from} is outside 1..${last}`);
    const end = Math.min(last, to ?? from + DEFAULT_PAGE_SPAN - 1);
    if (end < from) throw new Error(`to_page ${to} is before from_page ${from}`);
    const pages = [];
    for (let n = from; n <= end; n++) pages.push({ page: n, text: await pageText(doc, n) });
    return { path: file, pages_total: last, pages, next_page: end < last ? end + 1 : null };
  } finally {
    await doc.destroy();
  }
}

/**
 * Pages whose text contains `query` (case-insensitive), each with short snippets.
 * @param {string} file @param {string} query @param {number} [maxHits]
 */
async function search(file, query, maxHits = 50) {
  const needle = query.toLocaleLowerCase();
  if (!needle.trim()) throw new Error("query is empty");
  const doc = await open(file);
  try {
    const hits = [];
    let total = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const text = (await pageText(doc, n)).replace(/\s+/g, " ");
      const lower = text.toLocaleLowerCase();
      for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
        total++;
        if (hits.length < maxHits) {
          hits.push({ page: n, snippet: text.slice(Math.max(0, at - 80), at + needle.length + 80) });
        }
      }
    }
    return { path: file, query, matches_total: total, matches: hits };
  } finally {
    await doc.destroy();
  }
}

module.exports = { DEFAULT_PAGE_SPAN, info, readText, search };

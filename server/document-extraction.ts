/**
 * Shared Document Extraction Module
 *
 * Shared text extraction, chunking, and quality analysis.
 * Used by the MCP server, REST API, and email attachment processor.
 *
 * IMPORTANT: This file is duplicated in two deploy bundles:
 *   - server/document-extraction.ts          (MCP server — git-tracked)
 *   - supabase/functions/_shared/document-extraction.ts (Edge Functions — gitignored)
 * Keep both copies in sync. The server/ copy is the canonical source.
 *
 * Inspired by the heavy-file-ingestion skill's Python converters, adapted
 * for the Deno Edge Function runtime (no Python, no native modules).
 */

import { unzipSync } from "npm:fflate@0.8.2";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExtractionResult {
  text: string;
  pages: number;
  quality: ExtractionQuality;
}

export interface ExtractionQuality {
  converter: string;
  quality_flags: string[];
  stats: Record<string, number>;
  recommended_next_step: string;
}

// ─── PDF Extraction ──────────────────────────────────────────────────────────

/**
 * Extract text from PDF with per-page structure and quality analysis.
 * Uses unpdf (WASM-based PDF.js) with raw stream fallback.
 */
async function extractPdfText(buffer: Uint8Array): Promise<ExtractionResult> {
  const quality: ExtractionQuality = {
    converter: "unpdf",
    quality_flags: [],
    stats: {},
    recommended_next_step: "read_extracted_artifact",
  };

  try {
    const { extractText: pdfExtract } = await import("npm:unpdf@0.12.1");
    // Per-page extraction for structured output + quality analysis
    const result = await pdfExtract(buffer, { mergePages: false });
    const pageTexts: string[] = Array.isArray(result.text) ? result.text : [result.text || ""];
    const totalPages = result.totalPages || pageTexts.length || 1;

    // Build structured per-page output (mirrors Python skill's convert_pdf)
    const lines: string[] = [];
    let nonEmptyPages = 0;
    let totalChars = 0;

    for (let i = 0; i < pageTexts.length; i++) {
      const pageText = (pageTexts[i] || "").trim();
      lines.push(`## Page ${i + 1}`);
      lines.push("");
      if (pageText) {
        lines.push(pageText);
        nonEmptyPages++;
        totalChars += pageText.length;
      } else {
        lines.push("_No extractable text found on this page._");
      }
      lines.push("");
    }

    quality.stats = {
      page_count: totalPages,
      non_empty_pages: nonEmptyPages,
      text_chars: totalChars,
      avg_chars_per_page: totalPages > 0 ? Math.round(totalChars / totalPages) : 0,
    };

    // Quality flags matching the Python skill's thresholds
    if (totalPages > 0 && nonEmptyPages / totalPages < 0.7) {
      quality.quality_flags.push("scanned_pdf_suspected");
    }
    if (totalPages >= 3 && totalChars / totalPages < 120) {
      quality.quality_flags.push("low_text_density");
    }
    if (quality.quality_flags.length > 0) {
      quality.recommended_next_step = "cheap_model_or_stronger_converter";
    }

    return { text: lines.join("\n"), pages: totalPages, quality };
  } catch {
    // Fallback: raw stream parsing
    quality.converter = "raw-stream-fallback";
    const str = new TextDecoder("latin1").decode(buffer);
    const textParts: string[] = [];
    const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
    let match;
    while ((match = streamRegex.exec(str)) !== null) {
      const content = match[1];
      for (const tj of content.matchAll(/\(([^)]*)\)\s*Tj/g)) textParts.push(tj[1]);
      for (const td of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
        for (const it of td[1].matchAll(/\(([^)]*)\)/g)) textParts.push(it[1]);
      }
    }
    const pageMatches = str.match(/\/Type\s*\/Page[^s]/g);
    const pages = pageMatches?.length || 1;
    const text = textParts.join(" ");

    quality.quality_flags.push("fallback_parser_used");
    quality.stats = { page_count: pages, text_chars: text.length };
    quality.recommended_next_step = "cheap_model_or_stronger_converter";

    return { text, pages, quality };
  }
}

// ─── DOCX Extraction ─────────────────────────────────────────────────────────

/**
 * Extract text from DOCX with heading detection and table extraction.
 * Parses paragraph styles for heading levels (mirrors Python skill's convert_docx).
 */
function extractDocxText(buffer: Uint8Array): ExtractionResult {
  const files = unzipSync(buffer);
  const documentXml = files["word/document.xml"];
  if (!documentXml) throw new Error("Invalid DOCX: no word/document.xml");
  const xml = new TextDecoder().decode(documentXml);

  const quality: ExtractionQuality = {
    converter: "native-docx",
    quality_flags: [],
    stats: {},
    recommended_next_step: "read_extracted_artifact",
  };

  const lines: string[] = [];
  let headingCount = 0;
  let paragraphCount = 0;

  // Parse paragraph-by-paragraph for heading awareness
  // Split on <w:p> blocks to detect styles
  const paragraphs = xml.split(/<w:p[\s>]/);

  for (const para of paragraphs) {
    if (!para) continue;

    // Detect heading style: <w:pStyle w:val="Heading1"/>
    const styleMatch = para.match(/<w:pStyle\s+w:val="Heading(\d)"/);
    const headingLevel = styleMatch ? Math.min(parseInt(styleMatch[1]), 6) : 0;

    // Extract text from <w:t> tags within this paragraph
    const textParts: string[] = [];
    for (const m of para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)) {
      textParts.push(m[1]);
    }
    const text = textParts.join("").trim();
    if (!text) continue;

    if (headingLevel > 0) {
      lines.push(`${"#".repeat(headingLevel)} ${text}`);
      lines.push("");
      headingCount++;
    } else {
      lines.push(text);
      lines.push("");
      paragraphCount++;
    }
  }

  // Extract tables from <w:tbl> blocks
  let tableCount = 0;
  const tableBlocks = xml.split(/<w:tbl[\s>]/);
  for (let t = 1; t < tableBlocks.length; t++) {
    const tableXml = tableBlocks[t].split(/<\/w:tbl>/)[0];
    if (!tableXml) continue;
    tableCount++;

    const rows: string[][] = [];
    const rowBlocks = tableXml.split(/<w:tr[\s>]/);

    for (const rowBlock of rowBlocks) {
      if (!rowBlock) continue;
      const cells: string[] = [];
      const cellBlocks = rowBlock.split(/<w:tc[\s>]/);

      for (const cellBlock of cellBlocks) {
        if (!cellBlock) continue;
        const cellTexts: string[] = [];
        for (const m of cellBlock.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)) {
          cellTexts.push(m[1]);
        }
        const cellText = cellTexts.join("").trim();
        if (cellText || cells.length > 0) cells.push(cellText);
      }
      if (cells.length > 0) rows.push(cells);
    }

    if (rows.length > 0) {
      lines.push(`## Table ${tableCount}`);
      lines.push("");
      // Header row
      const header = rows[0];
      const maxCols = Math.max(...rows.map(r => r.length));
      const paddedHeader = [...header, ...Array(Math.max(0, maxCols - header.length)).fill("")];
      lines.push("| " + paddedHeader.join(" | ") + " |");
      lines.push("| " + paddedHeader.map(() => "---").join(" | ") + " |");
      // Data rows (cap at 10 for token efficiency)
      const dataRows = rows.slice(1, 11);
      for (const row of dataRows) {
        const padded = [...row, ...Array(Math.max(0, maxCols - row.length)).fill("")];
        lines.push("| " + padded.join(" | ") + " |");
      }
      if (rows.length > 11) {
        lines.push("");
        lines.push(`_Table truncated after 11 rows for token efficiency (${rows.length} total)._`);
      }
      lines.push("");
    }
  }

  quality.stats = {
    heading_count: headingCount,
    paragraph_count: paragraphCount,
    table_count: tableCount,
  };
  if (headingCount === 0 && paragraphCount < 5) {
    quality.quality_flags.push("low_text_output");
    quality.recommended_next_step = "cheap_model_or_stronger_converter";
  }

  return { text: lines.join("\n"), pages: 1, quality };
}

// ─── XLSX Extraction ─────────────────────────────────────────────────────────

/**
 * Extract text from XLSX with per-sheet structure, column headers, and preview rows.
 * Mirrors Python skill's convert_xlsx with proper row/column reconstruction.
 */
function extractXlsxText(buffer: Uint8Array): ExtractionResult {
  const files = unzipSync(buffer);

  const quality: ExtractionQuality = {
    converter: "native-xlsx",
    quality_flags: [],
    stats: {},
    recommended_next_step: "read_extracted_artifact",
  };

  // Parse shared strings lookup table
  const strings: string[] = [];
  const ssData = files["xl/sharedStrings.xml"];
  if (ssData) {
    const ssXml = new TextDecoder().decode(ssData);
    for (const m of ssXml.matchAll(/<si>[\s\S]*?<\/si>/g)) {
      const texts: string[] = [];
      for (const t of m[0].matchAll(/<t[^>]*>([^<]*)<\/t>/g)) texts.push(t[1]);
      strings.push(texts.join(""));
    }
  }

  // Parse sheet names from workbook.xml
  const sheetNames: string[] = [];
  const wbData = files["xl/workbook.xml"];
  if (wbData) {
    const wbXml = new TextDecoder().decode(wbData);
    for (const m of wbXml.matchAll(/<sheet\s+name="([^"]*)"/g)) {
      sheetNames.push(m[1]);
    }
  }

  // Parse each worksheet
  const sheetFiles = Object.keys(files)
    .filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => {
      const numA = parseInt(a.match(/sheet(\d+)/)?.[1] || "0");
      const numB = parseInt(b.match(/sheet(\d+)/)?.[1] || "0");
      return numA - numB;
    });

  const outputLines: string[] = [];
  let totalRows = 0;

  for (let s = 0; s < sheetFiles.length; s++) {
    const sheetPath = sheetFiles[s];
    const sheetXml = new TextDecoder().decode(files[sheetPath] as Uint8Array);
    const sheetName = sheetNames[s] || `Sheet ${s + 1}`;

    // Parse rows and cells
    const rows: string[][] = [];
    const rowBlocks = sheetXml.split(/<row[\s>]/);

    for (const rowBlock of rowBlocks) {
      if (!rowBlock.includes("<c ") && !rowBlock.includes("<c>")) continue;
      const cells: Map<number, string> = new Map();

      for (const cellMatch of rowBlock.matchAll(/<c\s+([^>]*)>[\s\S]*?<\/c>/g)) {
        const attrs = cellMatch[1];
        // Get column reference (e.g., "A1" → column index)
        const refMatch = attrs.match(/r="([A-Z]+)\d+"/);
        const colIdx = refMatch ? colLetterToIndex(refMatch[1]) : cells.size;

        // Get cell type
        const typeMatch = attrs.match(/t="([^"]*)"/);
        const cellType = typeMatch ? typeMatch[1] : "n";

        // Get value
        const valueMatch = cellMatch[0].match(/<v>([^<]*)<\/v>/);
        let value = valueMatch ? valueMatch[1] : "";

        // Resolve shared string references
        if (cellType === "s" && value) {
          const idx = parseInt(value);
          value = strings[idx] ?? value;
        }

        cells.set(colIdx, value);
      }

      if (cells.size > 0) {
        const maxCol = Math.max(...cells.keys());
        const row: string[] = [];
        for (let c = 0; c <= maxCol; c++) {
          row.push(cells.get(c) ?? "");
        }
        rows.push(row);
      }
    }

    totalRows += rows.length;
    const header = rows[0] || [];
    const previewRows = rows.slice(1, 6);

    outputLines.push(`## Sheet ${s + 1}: ${sheetName}`);
    outputLines.push("");
    outputLines.push(`- Rows: \`${Math.max(rows.length - 1, 0)}\``);
    outputLines.push(`- Columns: \`${header.length}\``);
    outputLines.push(`- Header: \`${header.join(", ") || "none"}\``);
    outputLines.push("");

    // Markdown table preview
    if (header.length > 0 && previewRows.length > 0) {
      outputLines.push("| " + header.join(" | ") + " |");
      outputLines.push("| " + header.map(() => "---").join(" | ") + " |");
      for (const row of previewRows) {
        const padded = [...row, ...Array(Math.max(0, header.length - row.length)).fill("")];
        outputLines.push("| " + padded.slice(0, header.length).join(" | ") + " |");
      }
      if (rows.length > 6) {
        outputLines.push("");
        outputLines.push(`_Showing 5 of ${rows.length - 1} data rows._`);
      }
      outputLines.push("");
    }
  }

  quality.stats = { sheet_count: sheetFiles.length, total_rows: totalRows };
  if (sheetFiles.length === 0 || totalRows === 0) {
    quality.quality_flags.push("low_text_output");
    quality.recommended_next_step = "cheap_model_or_stronger_converter";
  }

  return { text: outputLines.join("\n"), pages: 1, quality };
}

/** Convert column letter(s) to zero-based index: A→0, B→1, Z→25, AA→26 */
function colLetterToIndex(letters: string): number {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

// ─── PPTX Extraction ─────────────────────────────────────────────────────────

/**
 * Extract text from PPTX with slide-by-slide structure.
 * Mirrors the Python skill's convert_pptx with slide titles and speaker notes.
 */
function extractPptxText(buffer: Uint8Array): ExtractionResult {
  const files = unzipSync(buffer);

  const quality: ExtractionQuality = {
    converter: "native-pptx",
    quality_flags: [],
    stats: {},
    recommended_next_step: "read_extracted_artifact",
  };

  // Get slide files sorted by number
  const slideFiles = Object.keys(files)
    .filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] || "0");
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] || "0");
      return numA - numB;
    });

  const lines: string[] = [];
  let titledSlides = 0;

  for (let i = 0; i < slideFiles.length; i++) {
    const slideXml = new TextDecoder().decode(files[slideFiles[i]] as Uint8Array);

    // Extract all text blocks
    const texts: string[] = [];
    for (const m of slideXml.matchAll(/<a:t>([^<]*)<\/a:t>/g)) {
      if (m[1].trim()) texts.push(m[1].trim());
    }

    // First text block is often the title
    const title = texts[0] || `Slide ${i + 1}`;
    if (texts[0]) titledSlides++;

    lines.push(`## Slide ${i + 1}: ${title}`);
    lines.push("");

    // Remaining text as bullet points (deduplicated)
    const seen = new Set<string>([title]);
    const bodyTexts = texts.slice(1).filter(t => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });

    if (bodyTexts.length > 0) {
      for (const t of bodyTexts) lines.push(`- ${t}`);
    } else if (!texts[0]) {
      lines.push("- No extractable text found on this slide.");
    }

    // Speaker notes (from notesSlides)
    const noteNum = i + 1;
    const notePath = `ppt/notesSlides/notesSlide${noteNum}.xml`;
    const noteData = files[notePath];
    if (noteData) {
      const noteXml = new TextDecoder().decode(noteData as Uint8Array);
      const noteTexts: string[] = [];
      for (const m of noteXml.matchAll(/<a:t>([^<]*)<\/a:t>/g)) {
        if (m[1].trim()) noteTexts.push(m[1].trim());
      }
      // Filter out slide number placeholder text
      const meaningfulNotes = noteTexts.filter(t => !/^\d+$/.test(t) && !seen.has(t));
      if (meaningfulNotes.length > 0) {
        lines.push("");
        lines.push("### Speaker Notes");
        lines.push("");
        lines.push(meaningfulNotes.join(" "));
      }
    }

    lines.push("");
  }

  quality.stats = {
    slide_count: slideFiles.length,
    titled_slides: titledSlides,
  };
  if (slideFiles.length === 0) {
    quality.quality_flags.push("low_text_output");
    quality.recommended_next_step = "cheap_model_or_stronger_converter";
  }

  return { text: lines.join("\n"), pages: slideFiles.length, quality };
}

// ─── Plain Text ──────────────────────────────────────────────────────────────

function extractPlainText(buffer: Uint8Array, filename: string): ExtractionResult {
  const text = new TextDecoder().decode(buffer);
  return {
    text,
    pages: 1,
    quality: {
      converter: "native-text",
      quality_flags: [],
      stats: { text_chars: text.length },
      recommended_next_step: "read_extracted_artifact",
    },
  };
}

// ─── Router ──────────────────────────────────────────────────────────────────

/**
 * Main extraction entry point. Routes to the right extractor based on file type.
 */
export async function extractText(
  buffer: Uint8Array,
  fileType: string,
  filename?: string,
): Promise<ExtractionResult> {
  switch (fileType) {
    case "pdf":
      return extractPdfText(buffer);
    case "docx":
      return extractDocxText(buffer);
    case "xlsx":
      return extractXlsxText(buffer);
    case "pptx":
      return extractPptxText(buffer);
    case "md":
    case "txt":
      return extractPlainText(buffer, filename || "file.txt");
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

// ─── File Type Detection ─────────────────────────────────────────────────────

const SUPPORTED_TYPES = new Set(["pdf", "docx", "xlsx", "pptx", "md", "txt"]);

export function getFileType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (SUPPORTED_TYPES.has(ext)) return ext;
  throw new Error(`Unsupported file type: .${ext}. Supported: ${[...SUPPORTED_TYPES].join(", ")}`);
}

export const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  md: "text/markdown",
  txt: "text/plain",
};

// ─── Chunking ────────────────────────────────────────────────────────────────

export function chunkText(text: string, maxWords = 4000, overlap = 200): string[] {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + maxWords, words.length);
    chunks.push(words.slice(start, end).join(" "));
    start = end - overlap;
    if (start >= words.length - overlap) break;
  }
  return chunks;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

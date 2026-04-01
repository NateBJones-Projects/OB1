# 07 — Document Management

Upload legal documents (PDFs, DOCX, XLSX) to your Superbrain. Text is extracted, embedded, and made searchable. Files are stored in Supabase Storage and linked to matters and contacts.

---

## How It Works

```
Upload document (base64)
  → Stored in Supabase Storage bucket
  → Text extracted (PDF/DOCX/XLSX)
  → Embedded as thought(s) with vector embeddings
  → Document record created, linked to matter + contact
  → Searchable via search_thoughts
```

---

## Uploading Documents

### Via AI Client (Claude/ChatGPT)

If your AI client supports file attachments and the MCP `upload_document` tool, you can say:

```
Upload this founding affidavit to the Russell matter, attorney is Errol Goss
```

The tool accepts base64-encoded file content, filename, matter name, and contact name.

### Via Claude Code

Claude Code can read local files and upload them:

```
Upload /path/to/plea.pdf to the Sampson matter
```

Claude Code will read the file, base64-encode it, and call `upload_document`.

### Via Script

For bulk uploads, use the Supabase client directly:

```typescript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Read and upload file
const bytes = await Deno.readFile("plea.pdf");
const base64 = btoa(String.fromCharCode(...bytes));

// Call your MCP endpoint or insert directly
```

---

## Supported File Types

| Type | Extension | Extraction Method |
|------|-----------|-------------------|
| PDF | `.pdf` | `unpdf` library (fallback: raw text stream parser) |
| Word | `.docx` | XML parsing from zip archive |
| Excel | `.xlsx` | Shared strings + sheet value parsing from zip |

---

## Size Limits

| Constraint | Limit |
|-----------|-------|
| Storage bucket | 50MB per file |
| MCP request (base64) | ~4.5MB raw file (6MB base64) |
| Text extraction | No limit (full text stored in `documents.full_text`) |
| Embedding | Truncated to 8,000 characters per thought |

For documents over ~6,000 words, the text is automatically chunked into overlapping segments, each stored as a separate searchable thought.

---

## Searching Documents

### By Content (semantic search)

Ask your AI naturally:

```
What did the founding affidavit in the Sampson matter say about damages?
```

The `search_thoughts` tool finds relevant content across all documents via vector similarity.

### By Metadata

```
List all documents for the Russell matter
Show me PDFs uploaded by Errol Goss
Search documents for "founding affidavit"
```

The `search_documents` and `list_documents` tools filter by matter, contact, filename, and file type.

---

## Document Tools

| Tool | Description |
|------|-------------|
| `upload_document` | Upload PDF/DOCX/XLSX with text extraction and embedding |
| `search_documents` | Search by matter, contact, filename, file type |
| `list_documents` | List documents grouped by matter |

---

## Storage Structure

Files are stored in the `documents` Supabase Storage bucket:

```
documents/
  matters/
    russell/
      1711800000000_PoC MacGregor v4.docx
    sampson-lombard/
      1711800000000_founding_affidavit.pdf
  unsorted/
    1711800000000_misc_document.xlsx
```

---

## Limitations

- **Scanned PDFs** (image-only) will extract little or no text. A warning is returned. Future enhancement: OCR via vision model.
- **Password-protected files** cannot be extracted.
- **Very large files** (>4.5MB) need to be uploaded directly to Storage, then processed separately.

---

Next: [08 — MCP Tools Reference](08-tools-reference.md)

-- Extraction Quality Metadata
-- Adds quality analysis from the heavy-file-ingestion-inspired extraction pipeline.
-- Stores converter name, quality flags (e.g., scanned_pdf_suspected, low_text_density),
-- extraction stats, and recommended next step.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS extraction_quality JSONB DEFAULT '{}';

-- Example extraction_quality value:
-- {
--   "converter": "unpdf",
--   "quality_flags": ["scanned_pdf_suspected", "low_text_density"],
--   "stats": { "page_count": 12, "non_empty_pages": 4, "text_chars": 1200, "avg_chars_per_page": 100 },
--   "recommended_next_step": "cheap_model_or_stronger_converter"
-- }

COMMENT ON COLUMN documents.extraction_quality IS
  'Quality metadata from document text extraction: converter used, quality flags, stats, recommended next step';

"use client";

import { useState, useRef } from "react";

const ACCEPTED = ".pdf,.docx,.xlsx,.md,.txt";
const MAX_SIZE_MB = 4.5;

interface UploadResult {
  filename?: string;
  file_type?: string;
  word_count?: number;
  page_count?: number;
  matter?: string;
  thoughts?: number;
  message?: string;
  error?: string;
}

export function DocumentUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [matterName, setMatterName] = useState("");
  const [contactName, setContactName] = useState("");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`File too large. Maximum is ${MAX_SIZE_MB}MB.`);
      return;
    }
    setFile(f);
    setError(null);
    setResult(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx", "xlsx", "md", "txt"].includes(ext || "")) {
      setError("Unsupported file type.");
      return;
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`File too large. Maximum is ${MAX_SIZE_MB}MB.`);
      return;
    }
    setFile(f);
    setError(null);
    setResult(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || uploading) return;

    setUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    if (matterName.trim()) formData.append("matter_name", matterName.trim());
    if (contactName.trim()) formData.append("contact_name", contactName.trim());
    if (description.trim()) formData.append("description", description.trim());

    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }
      setResult(data);
      setFile(null);
      setMatterName("");
      setContactName("");
      setDescription("");
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Drop zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            file
              ? "border-accent/40 bg-accent-surface"
              : "border-border hover:border-border-subtle hover:bg-bg-elevated"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            onChange={handleFileChange}
            className="hidden"
          />
          {file ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-text-primary">{file.name}</p>
              <p className="text-xs text-text-muted">
                {formatSize(file.size)} &middot; {file.name.split(".").pop()?.toUpperCase()}
              </p>
              <p className="text-xs text-accent">Click or drop to replace</p>
            </div>
          ) : (
            <div className="space-y-1">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="mx-auto text-text-muted mb-2">
                <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-sm text-text-secondary">
                Drop a file here or click to browse
              </p>
              <p className="text-xs text-text-muted">
                PDF, Word, Excel, Markdown, or plain text. Max {MAX_SIZE_MB}MB.
              </p>
            </div>
          )}
        </div>

        {/* Optional fields */}
        {file && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Matter (optional)
              </label>
              <input
                type="text"
                value={matterName}
                onChange={(e) => setMatterName(e.target.value)}
                placeholder="e.g. SAMPSON // LOMBARD"
                className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Attorney (optional)
              </label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="e.g. Errol Goss"
                className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-text-muted mb-1">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Founding affidavit in the interdict application"
                className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition"
              />
            </div>
          </div>
        )}

        {/* Submit */}
        {file && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={uploading}
              className="px-5 py-2 bg-accent hover:bg-accent/90 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? "Uploading..." : "Upload and index"}
            </button>
          </div>
        )}
      </form>

      {/* Success */}
      {result && !result.error && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 space-y-1">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-success flex-shrink-0">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              Document uploaded
            </span>
          </div>
          {result.message && (
            <pre className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed mt-1">
              {result.message}
            </pre>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}

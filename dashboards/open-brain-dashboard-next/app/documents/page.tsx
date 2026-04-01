import { requireSessionOrRedirect } from "@/lib/auth";
import { DocumentUpload } from "@/components/DocumentUpload";

export const dynamic = "force-dynamic";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

async function fetchDocuments(apiKey: string) {
  const res = await fetch(`${API_URL}/documents`, {
    headers: { "x-brain-key": apiKey },
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function DocumentsPage() {
  const { apiKey } = await requireSessionOrRedirect();

  let documents: {
    filename: string;
    file_type: string;
    page_count: number;
    word_count: number;
    matter_name: string;
    description: string;
    created_at: string;
  }[] = [];

  try {
    const data = await fetchDocuments(apiKey);
    documents = data.documents || data.data || data || [];
  } catch {
    documents = [];
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold mb-0.5">Documents</h1>
        <p className="text-text-muted text-sm">
          Upload and search legal documents. Text is extracted and made searchable.
        </p>
      </div>

      <div>
        <h2 className="text-sm font-medium text-text-secondary mb-3">Upload a document</h2>
        <DocumentUpload />
      </div>

      <div>
        <h2 className="text-sm font-medium text-text-secondary mb-3">
          Uploaded documents ({documents.length})
        </h2>

        {documents.length === 0 ? (
          <p className="text-text-muted text-sm">No documents uploaded yet.</p>
        ) : (
          <div className="bg-bg-surface border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-elevated">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-text-muted">File</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-text-muted">Matter</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-text-muted">Words</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-text-muted">Date</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium uppercase px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted border border-border">
                          {doc.file_type}
                        </span>
                        <div>
                          <p className="text-text-primary text-[13px] font-medium">{doc.filename}</p>
                          {doc.description && (
                            <p className="text-text-muted text-xs">{doc.description}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-text-secondary">
                      {doc.matter_name || "—"}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-text-muted text-right tabular-nums">
                      {doc.word_count?.toLocaleString() || "—"}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-text-muted text-right whitespace-nowrap">
                      {new Date(doc.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

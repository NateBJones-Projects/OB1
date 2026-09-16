"use client";

import { useState, useEffect, useCallback } from "react";

export function RestrictedToggle() {
  const [unlocked, setUnlocked] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Check current status on mount — hide toggle if not configured
  useEffect(() => {
    fetch("/api/restricted")
      .then((r) => r.json())
      .then((d) => {
        setUnlocked(d.unlocked === true);
        setConfigured(d.configured === true);
      })
      .catch(() => {});
  }, []);

  const handleUnlock = useCallback(async () => {
    if (!passphrase.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/restricted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as Record<string, string>).error || "Unlock failed"
        );
      }
      setUnlocked(true);
      setShowModal(false);
      setPassphrase("");
      // Reload to refresh filtered data
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlock failed");
    } finally {
      setLoading(false);
    }
  }, [passphrase]);

  const handleLock = useCallback(async () => {
    try {
      await fetch("/api/restricted", { method: "DELETE" });
      setUnlocked(false);
      window.location.reload();
    } catch {
      // ignore
    }
  }, []);

  // Don't render if restricted content feature is not configured
  if (!configured) return null;

  return (
    <>
      {/* Lock/unlock button */}
      <button
        onClick={() => (unlocked ? handleLock() : setShowModal(true))}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors w-full ${
          unlocked
            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20"
            : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
        }`}
        title={unlocked ? "Click to hide restricted content" : "Unlock restricted content"}
      >
        {unlocked ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-amber-400">
            <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 7V5a3 3 0 016 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-text-muted">
            <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
        {unlocked ? "Restricted visible" : "Restricted hidden"}
      </button>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-surface border border-border rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-semibold text-text-primary mb-1">
              Unlock Restricted Content
            </h3>
            <p className="text-sm text-text-secondary mb-4">
              Enter your passphrase to view restricted thoughts.
            </p>

            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              placeholder="Passphrase"
              autoFocus
              className="w-full px-4 py-2.5 bg-bg-elevated border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition mb-3"
            />

            {error && <p className="text-danger text-sm mb-3">{error}</p>}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowModal(false);
                  setPassphrase("");
                  setError(null);
                }}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUnlock}
                disabled={loading || !passphrase.trim()}
                className="px-4 py-2 text-sm bg-violet hover:bg-violet-dim text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Unlock"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

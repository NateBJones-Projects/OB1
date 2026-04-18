/**
 * Core hashing and text normalization utilities for Open Brain.
 */

import crypto from "node:crypto";

export function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function canonicalizeText(value) {
  return normalizeWhitespace(value).toLowerCase();
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

export function buildContentFingerprint(text) {
  return sha256Hex(canonicalizeText(text));
}

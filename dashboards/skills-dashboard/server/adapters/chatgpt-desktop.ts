import { emptyResult, type AdapterResult } from './shared.ts'

// ChatGPT Desktop keeps its product data (custom GPTs, conversations) as opaque
// cloud-synced blobs under ~/Library/Application Support/com.openai.chat — there
// is no on-disk skill store to scan. The column renders with this note.
export function scanChatGPTDesktop(): AdapterResult {
  return emptyResult('ChatGPT Desktop has no local skill store')
}

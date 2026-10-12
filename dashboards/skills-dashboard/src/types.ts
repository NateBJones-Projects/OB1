export type {
  DuplicateGroup,
  DuplicateVerdict,
  HarnessId,
  HarnessMeta,
  InstallDetail,
  MatrixPayload,
  MatrixRow,
  TreeNode,
} from '../server/types.ts'

export interface FileContentPayload {
  content: string
  binary: boolean
  truncated: boolean
  size: number
}

export const isPluginSource = (source: string) => source.startsWith('plugin:')

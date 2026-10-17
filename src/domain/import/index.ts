// Statement import: pure parsing + matching. See each module for the heuristics.
export { fold, looksLikeEbcdic, decodeEbcdic, parseCellAmount } from './text'
export { groupTextItems, linesFromPages, type TextPiece } from './pdfLines'
export {
  parseStatementText, parseMeta, detectInstallment, isSummary,
  type ParsedRow, type ParsedStatement, type StatementMeta, type StatementKind, type Direction, type Installment, type ParseOptions,
} from './statement'
export { parseTable, guessMapping, parseCsv, cellDateISO, type Cell, type ColumnMapping } from './table'
export { suggestCategory } from './category'
export {
  prepareImport, buildImport, reconcile, withImport,
  type ImportRow, type ImportKind, type PreparedImport, type Reconciliation, type BuiltImport, type PlanDraft, type PrepareOptions,
} from './prepare'

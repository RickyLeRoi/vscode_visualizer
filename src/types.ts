// ─── Data kinds ───────────────────────────────────────────────────────────────

export type DataKind =
  | 'datatable'
  | 'dataset'
  | 'list'
  | 'array'
  | 'dictionary'
  | 'unknown';

// ─── DataTable ────────────────────────────────────────────────────────────────

export interface ColumnInfo {
  name: string;
  typeName: string;
}

export interface DataTableData {
  kind: 'datatable';
  tableName: string;
  columns: ColumnInfo[];
  rows: string[][];
  totalRows: number;
  truncated: boolean;
  // Pagination metadata
  pageSize?: number;
  currentPage?: number;
  offset?: number;
}

// ─── DataSet ──────────────────────────────────────────────────────────────────

export interface DataSetData {
  kind: 'dataset';
  dataSetName: string;
  tables: DataTableData[];
}

// ─── List / Array ─────────────────────────────────────────────────────────────

export interface ItemData {
  index: number;
  value: string;
}

export interface ListData {
  kind: 'list' | 'array';
  typeName: string;
  items: ItemData[];
  totalCount: number;
  truncated: boolean;
  // Pagination metadata
  pageSize?: number;
  currentPage?: number;
  offset?: number;
}

// ─── Dictionary ───────────────────────────────────────────────────────────────

export interface EntryData {
  key: string;
  value: string;
}

export interface DictionaryData {
  kind: 'dictionary';
  // Pagination metadata
  pageSize?: number;
  currentPage?: number;
  offset?: number;
  typeName: string;
  entries: EntryData[];
  totalCount: number;
  truncated: boolean;
}

// ─── Unknown / Generic ────────────────────────────────────────────────────────

export interface PropertyData {
  name: string;
  value: string;
  typeName?: string;
}

export interface UnknownData {
  kind: 'unknown';
  typeName: string;
  expression: string;
  displayValue: string;
  properties: PropertyData[];
}

// ─── Union ────────────────────────────────────────────────────────────────────

export type VisualizerData =
  | DataTableData
  | DataSetData
  | ListData
  | DictionaryData
  | UnknownData;

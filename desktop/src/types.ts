export interface TableDto {
  columns: string[];
  rows: string[][];
  total_size: number;
}

export interface ApexOutcomeDto {
  compiled: boolean;
  success: boolean;
  compile_problem: string | null;
  exception_message: string | null;
  exception_stack_trace: string | null;
  line: number | null;
  column: number | null;
  logs: string;
}

export interface LogRefDto {
  id: string;
  operation: string;
  status: string;
  start_time: string;
  application: string;
}

export interface LogViewDto {
  raw: string;
  api_version: string | null;
  unit_count: number;
}

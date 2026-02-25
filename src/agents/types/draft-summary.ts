export interface DraftSummaryMetadata {
  patient_id: string;
  account_number: string;
  ai_discharge_summary_file_path: string;
  ai_discharge_summary_json_file_path: string;
}

export type DraftSummaryJson = Record<string, unknown>;

export interface DraftSummarySection {
  id: string;
  title: string;
  content: string;
}

export interface DraftSummaryTransformed {
  sections: DraftSummarySection[];
  references?: string[][];
}

export interface Reference {
  id: string;
  url: string;
  content: string;
  raw: string;
}

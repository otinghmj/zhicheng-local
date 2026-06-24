/**
 * 手写自 docs/api-contract.yaml（FROZEN 1.2）。
 * 日期、日期时间、URI、UUID 在 TypeScript 中均表示为 string。
 */

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'PARSE_ERROR'
  | 'SCRIPT_ERROR'
  | 'SCRIPT_TIMEOUT'
  | 'SCRIPT_RUNNING'
  | 'INTERNAL_ERROR';

export interface ApiError {
  error: string;
  code: ErrorCode;
  details?: Record<string, unknown>;
}

export type StatusBadgeVariant =
  | 'success'
  | 'info'
  | 'warning'
  | 'danger'
  | 'primary'
  | 'purple'
  | 'neutral';

export interface StateDefinition {
  id?: string;
  label?: string;
  aliases?: string[];
  description?: string;
  dashboard_group?: string;
  badge_variant?: StatusBadgeVariant;
}

/** 状态值必须在运行时以 GET /api/config/states 为准，前端不维护状态枚举。 */
export type ApplicationStatus = string;

export interface Application {
  num: number;
  date: string;
  company: string;
  role: string;
  score?: number | null;
  scoreRaw?: string;
  status: ApplicationStatus;
  pdfGenerated: boolean;
  reportPath?: string | null;
  reportNumber?: string;
  notes?: string;
  jobUrl?: string | null;
  platform?: PipelinePlatform | null;
  salary?: string | null;
  city?: string | null;
  direction?: string | null;
}

export interface ApplicationUpdate {
  status?: ApplicationStatus;
  notes?: string;
}

export interface ApplicationCreate {
  date: string;
  company: string;
  role: string;
  score?: number | null;
  status: ApplicationStatus;
  pdfGenerated?: boolean;
  reportPath?: string | null;
  notes?: string;
  jobUrl?: string | null;
}

export interface DashboardMetrics {
  total?: number;
  byStatus?: Record<string, number>;
  avgScore?: number;
  topScore?: number;
  withPdf?: number;
  actionable?: number;
  recentTrend?: Array<{
    date?: string;
    count?: number;
    avgScore?: number;
  }>;
  archetypeDistribution?: Record<string, number>;
}

export type PipelinePlatform = 'BOSS' | '猎聘' | '智联' | '前程无忧' | '其他';

export interface PipelineParsedItem {
  ok: true;
  url: string;
  company: string;
  role: string;
  salary: string;
  city: string;
  experience: string;
  education: string;
  industry: string;
  companySize: string;
  preFilterScore: number;
  platform: PipelinePlatform;
  processed: boolean;
  reportNum?: number;
  score?: number;
  pdfGenerated?: boolean;
}

export interface PipelineParseError {
  ok: false;
  raw: string;
  line: number;
}

export type PipelineItem = PipelineParsedItem | PipelineParseError;

export interface PipelineAddUrl {
  url: string;
  company?: string;
  role?: string;
}

export interface PipelinePatch {
  remove?: string[];
  updates?: Array<{
    url: string;
    processed: boolean;
  }>;
}

export interface EvaluationReportSummary {
  num?: number;
  company?: string;
  role?: string;
  date?: string;
  archetype?: string;
  score?: number;
  url?: string;
  pdfPath?: string;
  tldr?: string;
  remote?: string;
  compEstimate?: string;
  city?: string | null;
  salary?: string | null;
  postedDate?: string | null;
  trackerStatus?: ApplicationStatus | null;
  pdfExists?: boolean | null;
  direction?: string | null;
  reportPath?: string;
  scores?: ReportScores;
}

export interface ReportScores {
  cv_match: number;
  direction: number;
  salary: number;
  company: number;
  red_flags: number;
}

export interface ReportSection {
  title?: string;
  markdown?: string;
}

export interface ScoreDimension {
  name?: string;
  score?: number;
  weight?: number;
}

export interface EvaluationReportDetail {
  num?: number;
  company?: string;
  role?: string;
  date?: string;
  archetype?: string;
  score?: number;
  url?: string;
  direction?: string | null;
  reportPath?: string;
  scores?: ReportScores;
  pdfPath?: string;
  sections?: {
    A?: ReportSection;
    B?: ReportSection;
    C?: ReportSection;
    D?: ReportSection;
    E?: ReportSection;
    overall?: ReportSection;
    nextSteps?: ReportSection;
  };
  dimensions?: ScoreDimension[];
}

export type ArchetypeFit = 'primary' | 'secondary' | 'adjacent';

export interface UserProfile {
  candidate?: {
    full_name?: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    portfolio_url?: string;
    github?: string;
  };
  target_roles?: {
    primary?: string[];
    archetypes?: Array<{
      name?: string;
      level?: string;
      fit?: ArchetypeFit;
    }>;
  };
  narrative?: {
    headline?: string;
    exit_story?: string;
    superpowers?: string[];
    proof_points?: Array<{
      name?: string;
      url?: string;
      hero_metric?: string;
    }>;
  };
  compensation?: {
    target_range?: string;
    currency?: string;
    minimum?: string;
  };
  location?: {
    country?: string;
    city?: string;
    timezone?: string;
    visa_status?: string;
  };
}

export interface PortalConfig {
  title_filter?: {
    positive?: string[];
    negative?: string[];
    seniority_boost?: string[];
  };
  tracked_companies?: Array<{
    name?: string;
    careers_url?: string;
    enabled?: boolean;
  }>;
  search_queries?: {
    boss?: Array<{ query?: string; city?: string }>;
    zhaopin?: Array<{ query?: string; city?: string }>;
  };
}

export interface MarkdownFile {
  content: string;
  lastModified?: string;
}

export interface CityCode {
  name: string;
  code: string;
}

export interface CityCodes {
  boss: CityCode[];
  zhaopin: CityCode[];
  liepin: CityCode[];
  '51job': CityCode[];
}

export interface ScanHistoryEntry {
  url: string;
  firstSeen: string;
  portal: string;
  title: string;
  company: string;
  status: string;
}

export interface ScanHistoryDailyAggregate {
  date: string;
  portal: string;
  added: number;
  skipped: number;
}

export type BatchJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface BatchJob {
  id?: string;
  url?: string;
  status?: BatchJobStatus;
  reportNum?: string;
  score?: string;
  error?: string;
}

export type ScriptExecutionStatus = 'started' | 'completed' | 'failed' | 'canceled';

export interface ScriptProgress {
  step: string;
  current: number;
  total: number;
  found?: number;
}

export interface ScriptExecution {
  jobId?: string;
  script?: string;
  status?: ScriptExecutionStatus;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  progress?: ScriptProgress | null;
  logTail?: string;
}

export type AiTaskMode =
  | 'apply'
  | 'auto-pipeline'
  | 'batch'
  | 'contacto'
  | 'cv-deep-dive'
  | 'deep'
  | 'deep-prep-glossary'
  | 'deep-prep-immersion'
  | 'deep-prep-portfolio'
  | 'deep-prep-roleplay'
  | 'deep-prep-simulate'
  | 'interview-prep'
  | 'oferta'
  | 'ofertas'
  | 'pdf'
  | 'pipeline'
  | 'pre-filter'
  | 'project'
  | 'scan'
  | 'tracker'
  | 'training';

export interface AiTaskRequest {
  mode: AiTaskMode;
  target: string;
  args?: Record<string, unknown>;
}

export interface AiTaskAccepted {
  jobId: string;
}

export interface StoryBankStory {
  id: string;
  title: string;
  themes: string[];
  source: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  reflection: string;
  suitableFor: string[];
}

export interface StoryBankStoryCreate {
  title: string;
  themes: string[];
  source: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  reflection?: string;
  suitableFor?: string[];
}

export interface TaskHistoryEntry {
  taskId: string;
  script: string;
  args: string;
  started: string;
  ended?: string | null;
  exitCode?: number | null;
  found?: number | null;
  dedupRate?: number | null;
}

export interface ActivityLogEntry {
  ts: string;
  type: string;
  summary: string;
}

export interface MetricsHistoryEntry {
  date: string;
  scanned: number;
  pending: number;
  processed: number;
  applied: number;
  interview: number;
  offers: number;
}

export interface PdfFile {
  filename: string;
  size: number;
  mtime: string;
  company?: string | null;
  date?: string | null;
}

export interface InterviewPrepFile {
  slug: string;
  filename: string;
  exists: boolean;
  mtime: string | null;
}

export interface StateDefinition {
  id?: string;
  label?: string;
  aliases?: string[];
  description?: string;
  dashboard_group?: string;
}

export type ApplicationSortBy = 'num' | 'date' | 'score' | 'status' | 'company';
export type SortOrder = 'asc' | 'desc';
export type ScanHistoryAggregate = 'daily';

export type ScriptName =
  | 'merge'
  | 'verify'
  | 'normalize'
  | 'dedup'
  | 'doctor'
  | 'pdf'
  | 'boss-scan'
  | 'boss-hs'
  | 'zhaopin-hs'
  | 'pipeline-process'
  | 'sync-check';

export interface ScriptRunRequest {
  args?: string[];
  dryRun?: boolean;
}

export type SseEventType =
  | 'applications-updated'
  | 'pipeline-updated'
  | 'config-updated'
  | 'report-added'
  | 'batch-updated'
  | 'script-progress'
  | 'script-completed'
  | 'script-failed'
  | 'external-change';

export interface ListResponse<T> {
  data: T[];
  total: number;
}

export interface HealthResponse {
  ok: true;
  mode: 'local';
}

export type ApplicationsResponse = ListResponse<Application>;
export type ApplicationCreateResponse = Application;
export type ApplicationDetailResponse = Application;
export type ApplicationUpdateResponse = Application;
export type ApplicationMetricsResponse = DashboardMetrics;

export interface PipelineResponse {
  pending?: PipelineItem[];
  processed?: PipelineItem[];
  errors?: PipelineItem[];
}

export type PipelineAddResponse = PipelineItem;

export type PipelinePatchResponse = PipelineResponse;

export type ReportsResponse = ListResponse<EvaluationReportSummary>;
export type ReportDetailResponse = EvaluationReportDetail;
export type RawMarkdownResponse = string;
export type ProfileResponse = UserProfile;
export type PortalsResponse = PortalConfig;
export type MarkdownFileResponse = MarkdownFile;
export type StatesResponse = StateDefinition[];
export type StoryBankResponse = ListResponse<StoryBankStory>;
export type StoryBankCreateResponse = StoryBankStory;
export type ScanHistoryResponse =
  | ListResponse<ScanHistoryEntry>
  | ListResponse<ScanHistoryDailyAggregate>;

export interface BatchResponse {
  jobs?: BatchJob[];
  pendingMerge?: number;
  summary?: {
    total?: number;
    completed?: number;
    failed?: number;
    pending?: number;
  };
}

export type TaskHistoryResponse = ListResponse<TaskHistoryEntry>;
export type ActivityLogResponse = ListResponse<ActivityLogEntry>;
export type MetricsHistoryResponse = ListResponse<MetricsHistoryEntry>;
export type ScriptRunResponse = ScriptExecution;
export type ScriptCancelResponse = ScriptExecution;
export type ScriptStatusResponse = ScriptExecution;
export type AiTaskResponse = AiTaskAccepted;
export type PdfFilesResponse = ListResponse<PdfFile>;
export type PdfFileResponse = Blob;
export type InterviewPrepFilesResponse = ListResponse<InterviewPrepFile>;
export type InterviewPrepDetailResponse = string;
export type EventsResponse = string;

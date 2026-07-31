/**
 * API 兼容导出。工作流执行器位于 db package，供 API 与 Worker 共同使用。
 */
export {
  generateStructuredReport,
  runAgentWorkflow,
  type AnalysisType,
  type RunWorkflowInput,
  type RunWorkflowOptions,
  type RunWorkflowResult,
  type WorkflowCallbacks,
} from "@devscope/db";

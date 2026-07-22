import { LEGACY_WORKFLOW_STEPS, WORKFLOW_STEPS, type ActiveWorkflowStep, type WorkflowStep } from "../types.js";

export function nextStep(lastCompletedStep: WorkflowStep | null): ActiveWorkflowStep {
  if (!lastCompletedStep) return "ready";
  if (LEGACY_WORKFLOW_STEPS.includes(lastCompletedStep as (typeof LEGACY_WORKFLOW_STEPS)[number])) return "properties_processed";
  const index = WORKFLOW_STEPS.indexOf(lastCompletedStep as ActiveWorkflowStep);
  if (index < 0) return "properties_processed";
  return WORKFLOW_STEPS[Math.min(index + 1, WORKFLOW_STEPS.length - 1)]!;
}

export function canTransition(from: WorkflowStep, to: WorkflowStep): boolean {
  const fromIndex = WORKFLOW_STEPS.indexOf(from as ActiveWorkflowStep);
  const toIndex = WORKFLOW_STEPS.indexOf(to as ActiveWorkflowStep);
  return toIndex === fromIndex || toIndex === fromIndex + 1;
}

export class WorkflowStateMachine {
  constructor(
    public current: ActiveWorkflowStep,
    public lastCompleted: WorkflowStep | null,
  ) {}

  complete(step: ActiveWorkflowStep): ActiveWorkflowStep {
    if (step !== this.current) throw new Error(`Step atteso ${this.current}, ricevuto ${step}`);
    this.lastCompleted = step;
    this.current = nextStep(step);
    return this.current;
  }

  static resume(lastCompleted: WorkflowStep | null): WorkflowStateMachine {
    return new WorkflowStateMachine(nextStep(lastCompleted), lastCompleted);
  }
}

import { WORKFLOW_STEPS, type WorkflowStep } from "../types.js";

export function nextStep(lastCompletedStep: WorkflowStep | null): WorkflowStep {
  if (!lastCompletedStep) return "ready";
  const index = WORKFLOW_STEPS.indexOf(lastCompletedStep);
  return WORKFLOW_STEPS[Math.min(index + 1, WORKFLOW_STEPS.length - 1)]!;
}

export function canTransition(from: WorkflowStep, to: WorkflowStep): boolean {
  const fromIndex = WORKFLOW_STEPS.indexOf(from);
  const toIndex = WORKFLOW_STEPS.indexOf(to);
  return toIndex === fromIndex || toIndex === fromIndex + 1;
}

export class WorkflowStateMachine {
  constructor(
    public current: WorkflowStep,
    public lastCompleted: WorkflowStep | null,
  ) {}

  complete(step: WorkflowStep): WorkflowStep {
    if (step !== this.current) throw new Error(`Step atteso ${this.current}, ricevuto ${step}`);
    this.lastCompleted = step;
    this.current = nextStep(step);
    return this.current;
  }

  static resume(lastCompleted: WorkflowStep | null): WorkflowStateMachine {
    return new WorkflowStateMachine(nextStep(lastCompleted), lastCompleted);
  }
}


import { Link } from 'react-router-dom';

interface WorkflowStepsProps {
  currentStep: 1 | 2 | 3;
}

const steps = [
  {
    id: 1 as const,
    title: 'Estimate',
    description: 'Create and approve customer quotation',
    to: '/estimates'
  },
  {
    id: 2 as const,
    title: 'Job',
    description: 'Convert estimate and execute the work',
    to: '/jobs'
  },
  {
    id: 3 as const,
    title: 'Invoice',
    description: 'Generate final bill from completed job',
    to: '/invoices'
  }
];

export const WorkflowSteps = ({ currentStep }: WorkflowStepsProps) => {
  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Estimate to Invoice Workflow</div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {steps.map((step) => {
          const isCurrent = step.id === currentStep;
          const isDone = step.id < currentStep;
          return (
            <div
              key={step.id}
              className={`rounded-lg border p-3 ${
                isCurrent
                  ? 'border-brand-300 bg-brand-50'
                  : isDone
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step {step.id}</div>
                <div
                  className={`badge ${
                    isCurrent
                      ? 'bg-brand-100 text-brand-700'
                      : isDone
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {isCurrent ? 'Current' : isDone ? 'Done' : 'Pending'}
                </div>
              </div>
              <div className="text-sm font-semibold text-slate-900">{step.title}</div>
              <div className="mt-1 text-xs text-slate-600">{step.description}</div>
              <Link className="mt-2 inline-flex text-xs font-medium text-brand-700 hover:underline" to={step.to}>
                Open {step.title}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
};

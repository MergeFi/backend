import type { Policy } from '@/types';
import { formatDate } from '@/lib/format';

interface PolicyStatusTimelineProps {
  policy:    Policy;
  className?: string;
}

interface TimelineEvent {
  label:      string;
  date:       string;
  done:       boolean;
  cancelled?: boolean;
}

export function PolicyStatusTimeline({ policy, className }: PolicyStatusTimelineProps) {
  const isCancelled = policy.status === 'Cancelled';

  // Merge "Policy purchased" + "Coverage active" into one step since they share
  // the same timestamp (instant activation model — issue #68).
  const events: TimelineEvent[] = [
    {
      label: 'Policy purchased & coverage activated',
      date:  formatDate(policy.startTime),
      done:  true,
    },
  ];

  if (isCancelled) {
    // Issue #67: show a distinct cancelled terminal step; omit the normal flow steps.
    events.push({
      label:      'Policy cancelled',
      date:       (policy as Policy & { cancelledAt?: number }).cancelledAt
                    ? formatDate((policy as Policy & { cancelledAt?: number }).cancelledAt!)
                    : '',
      done:       true,
      cancelled:  true,
    });
  } else {
    events.push(
      {
        label: 'Oracle monitoring',
        date:  'Continuous',
        done:  policy.status === 'Active',
      },
      {
        label: policy.status === 'Claimed' ? 'Claim paid out' : 'Policy expires',
        date:  formatDate(policy.endTime),
        done:  policy.status === 'Claimed' || policy.status === 'Expired',
      },
    );
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <div className="absolute left-3 top-0 h-full w-px bg-white/10" />
      <ol className="space-y-6">
        {events.map((event, i) => (
          <li key={i} className="relative flex items-start gap-4 pl-8">
            <div
              className={`absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                event.cancelled
                  ? 'bg-red-500 text-white'
                  : event.done
                  ? 'bg-teal-500 text-white'
                  : 'border border-white/20 text-gray-600 bg-gray-950'
              }`}
            >
              {event.done ? '✓' : i + 1}
            </div>
            <div>
              <p
                className={`text-sm font-semibold ${
                  event.cancelled
                    ? 'text-red-400'
                    : event.done
                    ? 'text-white'
                    : 'text-gray-500'
                }`}
              >
                {event.label}
              </p>
              {event.date && <p className="text-xs text-gray-500">{event.date}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

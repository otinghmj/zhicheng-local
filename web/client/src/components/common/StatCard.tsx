import type { ReactNode } from 'react';

export type StatTone = 'primary' | 'success' | 'info' | 'warning' | 'danger' | 'purple';

type StatCardProps = {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
  delta?: ReactNode;
  deltaDirection?: 'up' | 'down' | 'neutral';
};

export function StatCard({
  label,
  value,
  icon,
  tone = 'primary',
  delta,
  deltaDirection = 'neutral',
}: StatCardProps) {
  return (
    <article className="common-stat">
      <div>
        <div className="common-stat__label">{label}</div>
        <div className="common-stat__value">{value}</div>
        {delta === undefined ? null : (
          <div className={`common-stat__delta common-stat__delta--${deltaDirection}`}>{delta}</div>
        )}
      </div>
      {icon === undefined ? null : (
        <div className={`common-stat__icon common-stat__icon--${tone}`}>{icon}</div>
      )}
    </article>
  );
}

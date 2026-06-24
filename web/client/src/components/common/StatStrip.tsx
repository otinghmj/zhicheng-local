import type { ReactNode } from 'react';

type StatStripItem = {
  key: string;
  label: ReactNode;
  value: ReactNode;
  tone?: 'default' | 'primary' | 'success';
};

type StatStripProps = {
  items: StatStripItem[];
};

export function StatStrip({ items }: StatStripProps) {
  return (
    <div className="common-stat-strip">
      {items.map(({ key, label, value, tone = 'default' }) => (
        <div className="common-stat-strip__item" key={key}>
          <div className="common-stat-strip__label">{label}</div>
          <div className={`common-stat-strip__value common-stat-strip__value--${tone}`}>{value}</div>
        </div>
      ))}
    </div>
  );
}

import { InboxOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

type EmptyStateProps = {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
};

export function EmptyState({
  title = '暂无数据',
  description,
  action,
  icon = <InboxOutlined />,
}: EmptyStateProps) {
  return (
    <div className="common-empty">
      <span className="common-empty__icon">{icon}</span>
      <strong>{title}</strong>
      {description === undefined ? null : <span>{description}</span>}
      {action === undefined ? null : <div className="common-empty__action">{action}</div>}
    </div>
  );
}

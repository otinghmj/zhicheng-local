export type TriState = 'not-started' | 'generating' | 'completed';

type TriStateBadgeProps = {
  state: TriState;
};

const triStateMeta: Record<TriState, { label: string; variant: string }> = {
  'not-started': { label: '未开始', variant: 'neutral' },
  generating: { label: '生成中', variant: 'primary' },
  completed: { label: '已完成', variant: 'success' },
};

export function TriStateBadge({ state }: TriStateBadgeProps) {
  const meta = triStateMeta[state];
  return <span className={`common-tag common-tag--${meta.variant}`}>{meta.label}</span>;
}

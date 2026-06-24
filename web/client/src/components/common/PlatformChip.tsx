export type PlatformChipVariant = 'liepin' | 'boss' | 'zhaopin' | '51job' | 'lagou' | 'maimai';

type PlatformChipProps = {
  variant: PlatformChipVariant;
  label?: string;
  title?: string;
};

const defaultLabels: Record<PlatformChipVariant, string> = {
  liepin: '猎',
  boss: 'B',
  zhaopin: '智',
  '51job': '51',
  lagou: '拉',
  maimai: '脉',
};

export function PlatformChip({ variant, label = defaultLabels[variant], title }: PlatformChipProps) {
  return (
    <span className={`common-platform common-platform--${variant}`} title={title}>
      {label}
    </span>
  );
}

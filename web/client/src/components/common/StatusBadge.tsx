import { useDataStore } from '../../stores/dataStore';
import type { StateDefinition, StatusBadgeVariant } from '../../types';

type StatusBadgeProps = {
  status: string;
  label?: string;
  definitions?: StateDefinition[];
  pill?: boolean;
};

function findDefinition(status: string, definitions: StateDefinition[]) {
  const normalized = status.trim().toLowerCase();
  return definitions.find(
    ({ id, label, aliases = [] }) =>
      id?.toLowerCase() === normalized ||
      label?.toLowerCase() === normalized ||
      aliases.some((alias) => alias.toLowerCase() === normalized),
  );
}

function variantClass(variant: StatusBadgeVariant | undefined) {
  return `common-tag--${variant ?? 'neutral'}`;
}

export function StatusBadge({ status, label, definitions, pill = false }: StatusBadgeProps) {
  const storeStates = useDataStore((s) => s.states);
  const resolved = definitions ?? storeStates;

  const definition = findDefinition(status, resolved);
  const className = [
    'common-tag',
    variantClass(definition?.badge_variant),
    pill ? 'common-tag--pill' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return <span className={className}>{label ?? definition?.label ?? status}</span>;
}

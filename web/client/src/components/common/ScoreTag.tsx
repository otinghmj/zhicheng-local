type ScoreTagProps = {
  score: number;
  max?: number;
};

export function ScoreTag({ score, max = 5 }: ScoreTagProps) {
  const safeMax = Math.max(1, Math.round(max));
  const filled = Math.min(safeMax, Math.max(0, Math.round(score)));
  const warning = score < safeMax * 0.8;

  return (
    <span className="common-score" aria-label={`${score} / ${safeMax} 分`}>
      <span className="common-score__number">
        {score.toFixed(1)} <small>/ {safeMax}</small>
      </span>
      <span className={`common-score__stars${warning ? ' common-score__stars--warning' : ''}`}>
        {'★'.repeat(filled)}
        <span className="common-score__stars-off">{'★'.repeat(safeMax - filled)}</span>
      </span>
    </span>
  );
}

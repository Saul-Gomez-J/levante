import { cn } from '@/lib/utils';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { useTranslation } from 'react-i18next';

export interface ContextUsageData {
  used: number;
  contextLength: number;
  percentage: number;
  isEstimate: boolean;
  activeMessageTokens?: number;
  overheadTokens?: number;
  responseReserveTokens?: number;
  isLearnedOverhead?: boolean;
}

interface ContextUsageIndicatorProps {
  usage: ContextUsageData | null;
  onCompact: () => void;
  compactDisabled?: boolean;
  isCompacting?: boolean;
}

function formatTokens(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return `${value}`;
}

export function ContextUsageIndicator({
  usage,
  onCompact,
  compactDisabled = false,
  isCompacting = false,
}: ContextUsageIndicatorProps) {
  const { t } = useTranslation('chat');

  if (!usage) return null;

  const hasContext = usage.contextLength > 0;
  const pct = hasContext ? Math.max(0, Math.min(usage.percentage, 100)) : 0;
  const tone = hasContext
    ? pct >= 90
      ? 'critical'
      : pct >= 80
        ? 'warn'
        : 'neutral'
    : 'neutral';

  const prefix = usage.isEstimate ? '~' : '';
  const label = isCompacting
    ? t('context_usage.compacting')
    : hasContext
      ? `${t('context_usage.compact')} - ${prefix}${formatTokens(usage.used)} ${t('context_usage.tokens')} - ${pct}%`
      : `${t('context_usage.compact')} - ${prefix}${formatTokens(usage.used)} ${t('context_usage.tokens')}`;

  return (
    <div className="w-full mb-2 px-1 flex justify-end">
      <HoverCard openDelay={200} closeDelay={100}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            onClick={onCompact}
            disabled={compactDisabled}
            className={cn(
              'px-2 py-1 rounded border text-xs transition-colors',
              tone === 'critical' && 'border-red-500 text-red-600',
              tone === 'warn' && 'border-amber-500 text-amber-600',
              tone === 'neutral' && 'border-border text-muted-foreground',
              compactDisabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            {label}
          </button>
        </HoverCardTrigger>
        <HoverCardContent side="top" align="end" className="w-64 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('context_usage.tokens_used')}</span>
            <span>{formatTokens(usage.used)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('context_usage.precision')}</span>
            <span
              className={cn(
                'px-1 py-0.5 rounded text-[10px] font-medium',
                usage.isLearnedOverhead
                  ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                  : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
              )}
            >
              {usage.isLearnedOverhead
                ? t('context_usage.precision_real')
                : t('context_usage.precision_estimated')}
            </span>
          </div>

          {hasContext ? (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('context_usage.tokens_available')}</span>
                <span>{formatTokens(usage.contextLength)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('context_usage.used_ratio')}</span>
                <span>{pct}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('context_usage.tokens_remaining')}</span>
                <span>{formatTokens(Math.max(usage.contextLength - usage.used, 0))}</span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground italic pt-1">
              {t('context_usage.context_unknown')}
            </p>
          )}
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}

import type { Message } from '@/api/types';
import { Badge, EmptyState } from '@/components/ui';
import { formatDateTime } from '@/lib/money';
import { messageKindLabel } from '@/lib/labels';
import { cn } from '@/lib/cn';

export function OrderMessages({ messages }: { messages: Message[] }) {
  if (messages.length === 0) return <EmptyState compact title="No messages" description="Order confirmations and shipping notices Floor sends appear here, along with anything the buyer writes." />;
  const sorted = [...messages].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <ol className="flex flex-col gap-3 p-4">
      {sorted.map((m) => (
        <li key={m.id} className={cn('max-w-[85%] flex flex-col gap-1', m.direction === 'out' ? 'self-end items-end' : 'self-start items-start')}>
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <span>{m.direction === 'out' ? 'Floor' : 'Buyer'}</span>
            <Badge tone={m.kind === 'wismo' || m.kind === 'cancel' || m.kind === 'return' ? 'thin' : 'neutral'}>{messageKindLabel[m.kind]}</Badge>
            <time dateTime={m.at}>{formatDateTime(m.at)}</time>
          </div>
          <p className={cn('rounded-lg px-3.5 py-2.5 text-[13.5px] leading-relaxed', m.direction === 'out' ? 'bg-accent/10 text-ink' : 'bg-sunken')}>{m.body}</p>
        </li>
      ))}
    </ol>
  );
}

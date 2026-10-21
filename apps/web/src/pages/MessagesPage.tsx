import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Message } from '@/api/types';
import { useMessages, useReplyMessage } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Badge, Button, EmptyState, ErrorState, TableSkeleton, useToast } from '@/components/ui';
import { PageHeader } from '@/components/layout/PageHeader';
import { formatDateTime, relativeTime } from '@/lib/money';
import { messageKindLabel } from '@/lib/labels';
import { cn } from '@/lib/cn';

const kindTone = (k: Message['kind']): 'thin' | 'neutral' | 'accent' => (k === 'wismo' || k === 'cancel' || k === 'return' ? 'thin' : k === 'other' ? 'neutral' : 'accent');

export function MessagesPage() {
  const [unansweredOnly, setUnansweredOnly] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const { data, isPending, error, refetch } = useMessages({ unansweredOnly });
  const send = useReplyMessage();
  const toast = useToast();

  const inbound = useMemo(() => (data ?? []).filter((m) => m.direction === 'in'), [data]);
  const active = inbound.find((m) => m.id === activeId) ?? inbound[0] ?? null;
  const thread = useMessages({ orderId: active?.orderId });

  useEffect(() => { setReply(active?.suggestedReply ?? ''); }, [active?.id, active?.suggestedReply]);

  const onSend = () => {
    if (!active || !reply.trim()) return;
    send.mutate({ id: active.id, body: reply.trim() }, {
      onSuccess: () => { toast.success('Reply sent'); setActiveId(null); },
      onError: (e) => toast.error('Could not send', errorMessage(e)),
    });
  };

  return (
    <>
      <PageHeader
        title="Messages"
        description="Buyer messages, sorted into what they are asking for, with a reply drafted from the order's real status."
        actions={
          <label className="inline-flex items-center gap-2 text-[13.5px] cursor-pointer">
            <input type="checkbox" className="accent-accent" checked={unansweredOnly} onChange={(e) => setUnansweredOnly(e.target.checked)} /> Unanswered only
          </label>
        }
      />
      <div className="panel grid md:grid-cols-[320px_1fr] min-h-[60vh]">
        <div className="border-b md:border-b-0 md:border-r border-rule">
          {error ? <ErrorState message={errorMessage(error)} onRetry={() => refetch()} /> : isPending ? <TableSkeleton rows={5} cols={2} /> : inbound.length === 0 ? (
            <EmptyState compact title="Inbox is clear" description={unansweredOnly ? 'No buyer messages are waiting on a reply.' : 'No buyer messages yet.'} action={unansweredOnly ? <Button size="sm" onClick={() => setUnansweredOnly(false)}>Show all</Button> : undefined} />
          ) : (
            <ul className="divide-y divide-rule/70">
              {inbound.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => setActiveId(m.id)} aria-current={active?.id === m.id} className={cn('w-full text-left px-4 py-3 hover:bg-sunken/60', active?.id === m.id && 'bg-sunken')}>
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={kindTone(m.kind)}>{messageKindLabel[m.kind]}</Badge>
                      <time className="text-[12px] text-faint" dateTime={m.at}>{relativeTime(m.at)}</time>
                    </div>
                    <p className="text-[13.5px] mt-1.5 line-clamp-2">{m.body}</p>
                    <p className="text-[12px] text-muted mt-0.5">Order {m.orderId}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-[13.5px] text-muted p-6">Select a message to reply.</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-rule flex items-center justify-between gap-3 flex-wrap">
                <div className="text-[13.5px]"><span className="text-muted">About</span> <Link to={`/orders/${active.orderId}`} className="text-accent">order {active.orderId}</Link></div>
                <Badge tone={kindTone(active.kind)}>{messageKindLabel[active.kind]}</Badge>
              </div>
              <ol className="flex-1 flex flex-col gap-3 p-4 overflow-y-auto max-h-[40vh]">
                {(thread.data ?? [active]).slice().sort((a, b) => a.at.localeCompare(b.at)).map((m) => (
                  <li key={m.id} className={cn('max-w-[85%] flex flex-col gap-1', m.direction === 'out' ? 'self-end items-end' : 'self-start items-start')}>
                    <div className="text-[12px] text-muted">{m.direction === 'out' ? 'Floor' : 'Buyer'} · <time dateTime={m.at}>{formatDateTime(m.at)}</time></div>
                    <p className={cn('rounded-lg px-3.5 py-2.5 text-[13.5px] leading-relaxed', m.direction === 'out' ? 'bg-accent/10' : 'bg-sunken')}>{m.body}</p>
                  </li>
                ))}
              </ol>
              <div className="border-t border-rule p-4">
                <label htmlFor="reply" className="label">Reply {active.suggestedReply && <span className="text-faint">(suggested, edit freely)</span>}</label>
                <textarea id="reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={5} className="field resize-y leading-relaxed" />
                <div className="flex justify-end gap-2 mt-2">
                  {active.suggestedReply && reply !== active.suggestedReply && <Button onClick={() => setReply(active.suggestedReply ?? '')}>Reset to suggestion</Button>}
                  <Button variant="primary" onClick={onSend} loading={send.isPending} disabled={!reply.trim()}>Send reply</Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

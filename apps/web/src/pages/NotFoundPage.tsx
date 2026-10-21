import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/ui';

export function NotFoundPage() {
  return (
    <EmptyState
      title="There is nothing at this address"
      description="The page may have moved, or the link was mistyped."
      action={<Link to="/" className="text-accent underline underline-offset-2 text-[13.5px]">Back to the dashboard</Link>}
    />
  );
}

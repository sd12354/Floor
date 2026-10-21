import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
  /** Hide on phones; the content must be reachable elsewhere (detail page/drawer). */
  hideOnMobile?: boolean;
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selected?: Set<string>;
  caption?: string;
  className?: string;
}

export function Table<T>({ columns, rows, rowKey, onRowClick, selected, caption, className }: TableProps<T>) {
  return (
    <div className={cn('overflow-x-auto -mx-px', className)}>
      <table className="w-full border-collapse text-[13.5px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn('th', c.align === 'right' && 'text-right', c.hideOnMobile && 'hidden md:table-cell', c.className)}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = rowKey(row);
            return (
              <tr
                key={id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  onRowClick && 'cursor-pointer hover:bg-sunken/60',
                  selected?.has(id) && 'bg-accent/8',
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn('td', c.align === 'right' && 'text-right num', c.hideOnMobile && 'hidden md:table-cell', c.className)}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

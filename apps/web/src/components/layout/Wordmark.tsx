/** "Floor" with the brand's one gesture: a brick-red rule under the word. Nothing else in the UI gets a rule like it. */
export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className="inline-flex flex-col leading-none select-none">
      <span className={size === 'lg' ? 'font-display text-[34px]' : 'font-display text-[21px]'}>Floor</span>
      <span className="block h-[3px] w-full bg-floor rounded-sm mt-1" aria-hidden />
    </span>
  );
}

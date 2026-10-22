import type { EbayCategorySuggestion, EbaySetupResponse } from '@/api/types';

/** The four fixed lines from the server plus the category the seller picked (or a placeholder until they do). */
export function composeEnv(r: EbaySetupResponse, category: EbayCategorySuggestion | null): string {
  const fixed = r.envLines.split('\n').filter((l) => !l.includes('EBAY_DEFAULT_CATEGORY_ID'));
  fixed.push(category ? `EBAY_DEFAULT_CATEGORY_ID=${category.categoryId}` : '# EBAY_DEFAULT_CATEGORY_ID=<pick a category above>');
  return fixed.join('\n');
}

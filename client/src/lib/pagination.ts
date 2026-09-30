export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  pagination: Pagination;
}

export interface PageParams {
  page?: number;
  limit?: number;
}

// Must stay within the server's MAX_PAGE_SIZE.
export const MAX_PAGE_SIZE = 100;

/**
 * Walks every page of a paginated endpoint. Used by dashboards and views that
 * aggregate over all records; list pages should page with <Pager> instead.
 */
export async function fetchAllPages<T>(
  fetchPage: (params: PageParams) => Promise<Paginated<T>>
): Promise<T[]> {
  const first = await fetchPage({ page: 1, limit: MAX_PAGE_SIZE });
  const items = [...first.items];

  for (let page = 2; page <= first.pagination.totalPages; page += 1) {
    const next = await fetchPage({ page, limit: MAX_PAGE_SIZE });
    items.push(...next.items);
  }

  return items;
}

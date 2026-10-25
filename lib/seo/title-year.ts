/** Current UTC year for comparison/roundup titles, independent of editorial dates. */
export function withCurrentYear(title: string, now: Date = new Date()): string {
  return `${title} (${now.getUTCFullYear()})`
}

/** Format a real content-review date, never the current clock. */
export function updatedMonth(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

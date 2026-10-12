'use client'

import { useState } from 'react'

interface IosApp {
  id: string
  name: string
  developer_name?: string
  icon?: string
  release_date?: string
  rating_avg: number
  downloads_month?: number
  revenue_month?: number
  description_short?: string
  description_full?: string
  downloads_exact?: number
}

export default function SearchPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [limit, setLimit] = useState('10')
  const [apps, setApps] = useState<IosApp[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const queryParams = new URLSearchParams({
        action: 'search',
        term: searchTerm,
        limit: limit
      })
      
      if (startDate) {
        queryParams.append('start_date', startDate)
      }
      if (endDate) {
        queryParams.append('end_date', endDate)
      }

      const response = await fetch(`/api/appstore?${queryParams.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      })

      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch apps')
      }

      setApps(data.data || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">App Store Search</h1>
      
      <form onSubmit={handleSearch} className="space-y-4 mb-6">
        <div>
          <label className="block mb-1">Search Term</label>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full p-2 border rounded"
            placeholder="Enter app name..."
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full p-2 border rounded"
            />
          </div>

          <div>
            <label className="block mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full p-2 border rounded"
            />
          </div>
        </div>

        <div>
          <label className="block mb-1">Results Per Page</label>
          <select
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-full p-2 border rounded"
          >
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && (
        <div className="bg-red-100 text-red-700 p-4 rounded mb-4">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {apps.map((app) => (
          <div key={app.id} className="border rounded p-4">
            <div className="flex items-center gap-4">
              {app.icon && (
                <img src={app.icon} alt={app.name} className="w-16 h-16 rounded" />
              )}
              <div>
                <h3 className="font-bold">{app.name}</h3>
                <p className="text-sm text-gray-600">{app.developer_name}</p>
              </div>
            </div>
            {app.description_short && (
              <p className="text-sm text-gray-700 mt-2 line-clamp-2">{app.description_short}</p>
            )}
            {app.description_full && (
              <p className="text-sm text-gray-600 mt-2 line-clamp-4">{app.description_full}</p>
            )}
            <div className="mt-2 space-y-1">
              {app.release_date && (
                <p className="text-sm">Released: {new Date(app.release_date).toLocaleDateString()}</p>
              )}
              <p className="text-sm">Rating: {app.rating_avg.toFixed(1)}/5</p>
              {app.downloads_exact && (
                <p className="text-sm">Total Downloads: {app.downloads_exact.toLocaleString()}</p>
              )}
              {app.downloads_month && (
                <p className="text-sm">Monthly Downloads: {app.downloads_month.toLocaleString()}</p>
              )}
              {app.revenue_month && (
                <p className="text-sm">Monthly Revenue: ${app.revenue_month.toLocaleString()}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {apps.length === 0 && !loading && (
        <p className="text-center text-gray-500 mt-4">
          No apps found. Try adjusting your search criteria.
        </p>
      )}
    </div>
  )
} 
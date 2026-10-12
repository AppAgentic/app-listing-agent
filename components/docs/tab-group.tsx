'use client'

import { useState } from 'react'

interface Tab {
  label: string
  content: React.ReactNode
}

interface TabGroupProps {
  tabs: Tab[]
  defaultTab?: number
}

export function TabGroup({ tabs, defaultTab = 0 }: TabGroupProps) {
  const [activeTab, setActiveTab] = useState(defaultTab)

  return (
    <div className="my-6">
      {/* Tab headers */}
      <div className="flex border-b border-white/[0.08]">
        {tabs.map((tab, index) => (
          <button
            key={tab.label}
            onClick={() => setActiveTab(index)}
            className={`
              px-4 py-2 text-sm font-medium transition-colors
              ${
                activeTab === index
                  ? 'border-b-2 border-purple-500 text-purple-400'
                  : 'text-white/50 hover:text-white/70'
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-4">{tabs[activeTab]?.content}</div>
    </div>
  )
}

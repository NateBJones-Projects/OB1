'use client'

export type FilterTabsProps = {
  tabs: { label: string; value: string }[]
  activeTab: string
  onChange: (value: string) => void
}

export function FilterTabs({ tabs, activeTab, onChange }: FilterTabsProps) {
  return (
    <div className="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`min-h-[44px] flex-1 whitespace-nowrap px-3 text-sm font-medium transition-colors ${
            activeTab === tab.value
              ? 'border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

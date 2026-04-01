'use client'

type InstructionListProps = {
  instructions: string[]
  onChange: (instructions: string[]) => void
}

export function InstructionList({ instructions, onChange }: InstructionListProps) {
  function update(index: number, value: string) {
    onChange(instructions.map((s, i) => (i === index ? value : s)))
  }

  function remove(index: number) {
    onChange(instructions.filter((_, i) => i !== index))
  }

  function add() {
    onChange([...instructions, ''])
  }

  return (
    <div className="flex flex-col gap-2">
      {instructions.map((step, i) => (
        <div key={i} className="flex gap-2">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white mt-2">
            {i + 1}
          </span>
          <textarea
            value={step}
            onChange={(e) => update(i, e.target.value)}
            placeholder={`Step ${i + 1}`}
            rows={2}
            className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          <button
            onClick={() => remove(i)}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 hover:text-red-500 dark:text-gray-500 mt-1"
            aria-label="Remove step"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="2" y1="2" x2="12" y2="12" />
              <line x1="12" y1="2" x2="2" y2="12" />
            </svg>
          </button>
        </div>
      ))}

      <button
        onClick={add}
        className="mt-1 text-sm font-medium text-blue-600 dark:text-blue-400"
      >
        + Add step
      </button>
    </div>
  )
}

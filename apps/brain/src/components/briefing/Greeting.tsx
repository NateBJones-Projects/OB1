'use client'

type GreetingProps = {
  firstName: string
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export function Greeting({ firstName }: GreetingProps) {
  return (
    <div className="pt-2">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
        {getGreeting()}, {firstName}
      </h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{formatDate()}</p>
    </div>
  )
}

'use client'

import { useState } from 'react'

export type FieldConfig = {
  name: string
  label: string
  type: 'text' | 'textarea' | 'date' | 'select' | 'number'
  required?: boolean
  placeholder?: string
  options?: { label: string; value: string }[]
}

export type EditFormProps = {
  fields: FieldConfig[]
  initialValues?: Record<string, any>
  onSave: (values: Record<string, any>) => Promise<void>
  onCancel: () => void
  saveLabel?: string
  loading?: boolean
}

export function EditForm({
  fields,
  initialValues = {},
  onSave,
  onCancel,
  saveLabel = 'Save',
  loading: externalLoading,
}: EditFormProps) {
  const [values, setValues] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {}
    for (const f of fields) {
      init[f.name] = initialValues[f.name] ?? ''
    }
    return init
  })
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  const isLoading = externalLoading || saving

  function handleChange(name: string, value: any) {
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: false }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Validate required fields
    const newErrors: Record<string, boolean> = {}
    let hasError = false
    for (const f of fields) {
      if (f.required && !values[f.name]?.toString().trim()) {
        newErrors[f.name] = true
        hasError = true
      }
    }
    if (hasError) {
      setErrors(newErrors)
      return
    }

    setSaving(true)
    try {
      await onSave(values)
    } finally {
      setSaving(false)
    }
  }

  const inputClasses =
    'w-full min-h-[44px] rounded-lg border px-3 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {fields.map((field) => (
        <div key={field.name}>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {field.label}
            {field.required && (
              <span className="ml-0.5 text-red-500">*</span>
            )}
          </label>

          {field.type === 'textarea' ? (
            <textarea
              value={values[field.name] ?? ''}
              onChange={(e) => handleChange(field.name, e.target.value)}
              placeholder={field.placeholder}
              className={`${inputClasses} min-h-[120px] resize-y py-2 ${
                errors[field.name]
                  ? 'border-red-400 dark:border-red-500'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            />
          ) : field.type === 'select' ? (
            <select
              value={values[field.name] ?? ''}
              onChange={(e) => handleChange(field.name, e.target.value)}
              className={`${inputClasses} ${
                errors[field.name]
                  ? 'border-red-400 dark:border-red-500'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <option value="">{field.placeholder || 'Select…'}</option>
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={field.type}
              value={values[field.name] ?? ''}
              onChange={(e) => handleChange(field.name, e.target.value)}
              placeholder={field.placeholder}
              className={`${inputClasses} ${
                errors[field.name]
                  ? 'border-red-400 dark:border-red-500'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            />
          )}

          {errors[field.name] && (
            <p className="mt-1 text-xs text-red-500">This field is required</p>
          )}
        </div>
      ))}

      <div className="mt-2 flex flex-col gap-2">
        <button
          type="submit"
          disabled={isLoading}
          className="min-h-[44px] w-full rounded-lg bg-blue-600 text-sm font-medium text-white disabled:opacity-50 dark:bg-blue-500"
        >
          {isLoading ? 'Saving…' : saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] w-full text-sm font-medium text-gray-500 dark:text-gray-400"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
